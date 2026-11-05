const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SavedStore = require('../../frontend/saved_store.js');
const source = fs.readFileSync(require.resolve('../../frontend/saved.js'), 'utf8');
const researcher = { id:'A1', type:'researcher', display_name:'Researcher', note:'Original note', saved_at:'2026-10-29T00:00:00.000Z', context:{institution:{id:'I1'},references:[{id:'T1'}]} };
const paper = { id:'W2', type:'paper', display_name:'Paper', note:'Paper note', saved_at:'2026-10-29T01:00:00.000Z' };

// Minimal DOM fixture for the real saved-page event handlers. Storage is the
// production store; list identity and marker state are observable UI outcomes.
function element(tag = 'div') {
  return {
    tag, children:[], dataset:{}, attributes:{}, controls:{}, textContent:'', value:'',
    append(child) { child.parent = this; this.children.push(child); },
    replaceChildren() { this.children = []; },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    closest(selector) { return selector === '.saved-item' && this.parent?.className === 'saved-item' ? this.parent : null; },
    querySelector(selector) { return selector === 'button' ? this.children.find(x => x.tag === 'button') : this.controls[selector]; },
    focus() {}, click() { this.onclick?.(); },
    set innerHTML(html) {
      this.html = html;
      if (this.tag !== 'article') return;
      const slot = element('span'); slot.parent = this;
      const [, kind, id] = html.match(/data-save-(author|paper)="([^"]+)"/);
      slot.dataset[kind === 'author' ? 'saveAuthor' : 'savePaper'] = id;
      this.slot = slot;
      const textarea = element('textarea');
      textarea.value = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1];
      this.controls = {textarea, '.note-status':element(), '.reopen-search':element('button')};
    },
    get innerHTML() { return this.html; },
  };
}
function harness(items = [researcher, paper], { failWrites = false } = {}) {
  let disk = JSON.stringify({version:1,items});
  const nodes = new Map(), listeners = {}, notices = [], navigations = [], external = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const storage = {getItem:()=>disk,setItem:(key,value)=>{ if (failWrites) throw Error('quota'); disk=value; }};
  const events = (name, detail) => listeners[name]?.({detail});
  vm.runInNewContext(source, {
    document:{getElementById:node,createElement:element,querySelectorAll:()=>[...external,...node('saved-list').children.map(row=>row.slot)]},
    window:{SavedStore,ResearchApp:{esc:String,notice:message=>notices.push(message),navigate:path=>navigations.push(path),profile:()=>null},addEventListener:(name,fn)=>{listeners[name]=fn;}},
    localStorage:storage, Map, Blob, URL, setTimeout,
  });
  const rows = () => node('saved-list').children;
  const row = id => rows().find(row => (row.slot.dataset.saveAuthor || row.slot.dataset.savePaper) === id);
  const button = id => row(id).slot.querySelector('button');
  function outside(id) {
    const slot = element('span'); slot.dataset[id[0] === 'A' ? 'saveAuthor' : 'savePaper'] = id; external.push(slot);
    events('research-selection', {id,display_name:id === 'A1' ? 'Researcher' : 'Paper'});
    return slot.querySelector('button');
  }
  return {node,events,notices,navigations,rows,row,button,outside, persisted:()=>SavedStore.parse(disk)};
}

test('bookmarks toggle in place, synchronize duplicate controls, and preserve notes on a second click', () => {
  const h = harness();
  const firstRow = h.row('A1'), inside = h.button('A1'), outside = h.outside('A1');
  assert.equal(inside.getAttribute('aria-pressed'), 'true');
  assert.equal(inside.getAttribute('aria-label'), 'Save Researcher');
  assert.match(inside.innerHTML, /<svg.*aria-hidden="true"/);
  inside.click();
  assert.equal(h.row('A1'), firstRow);
  assert.equal(h.rows().length, 2);
  assert.equal(inside.getAttribute('aria-pressed'), 'false');
  assert.equal(outside.getAttribute('aria-pressed'), 'false');
  assert.equal(h.persisted().some(x=>x.id==='A1'), false);
  outside.click();
  assert.equal(h.row('A1'), firstRow);
  assert.equal(inside.getAttribute('aria-pressed'), 'true');
  assert.equal(outside.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(h.persisted().find(x=>x.id==='A1'), researcher);
  assert.deepEqual(h.navigations, []);
});

test('notes edited on an unchecked card remain a draft and are restored with its bookmark', () => {
  const h = harness(), row = h.row('A1');
  h.button('A1').click();
  row.querySelector('textarea').oninput({target:{value:'Edited while unchecked'}});
  assert.equal(h.persisted().some(x=>x.id==='A1'), false);
  assert.equal(row.querySelector('.note-status').textContent, 'Not saved');
  h.button('A1').click();
  assert.equal(h.persisted().find(x=>x.id==='A1').note, 'Edited while unchecked');
  assert.deepEqual(h.persisted().find(x=>x.id==='A1').context, researcher.context);
});

test('navigation recalculates unchecked cards even after another card autosaves a note', () => {
  const h = harness();
  h.button('A1').click();
  h.row('W2').querySelector('textarea').oninput({target:{value:'A later note'}});
  assert.equal(h.rows().length, 2);
  h.events('research-route', {view:'discover'});
  h.events('research-route', {view:'saved'});
  assert.equal(h.row('A1'), undefined);
  assert.equal(h.rows().length, 1);
  assert.equal(h.row('W2').querySelector('textarea').value, 'A later note');
  assert.equal(harness(h.persisted()).row('A1'), undefined);
});

test('changing the filter recalculates the list, while multiple unchecked cards can each be restored', () => {
  const h = harness();
  h.button('A1').click(); h.button('W2').click();
  assert.equal(h.rows().length, 2);
  h.button('A1').click();
  h.node('saved-filter').onchange({target:{value:'researcher'}});
  assert.equal(h.rows().length, 1);
  assert.equal(h.button('A1').getAttribute('aria-pressed'), 'true');
  h.node('saved-filter').onchange({target:{value:'all'}});
  assert.equal(h.row('W2'), undefined);
  assert.equal(h.persisted()[0].note, 'Original note');
});

test('a new result can be saved and unsaved without navigating, and the next Saved visit reflects it', () => {
  const h = harness([]), button = h.outside('W2');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  h.events('research-route', {view:'saved'});
  assert.equal(h.rows().length, 1);
  button.click();
  assert.equal(h.rows().length, 1);
  h.events('research-route', {view:'saved'});
  assert.equal(h.rows().length, 0);
  assert.deepEqual(h.navigations, []);
});

test('storage failure still provides reversible toggles and exposes the persistence warning', () => {
  const h = harness([researcher], {failWrites:true});
  h.button('A1').click();
  assert.equal(h.button('A1').getAttribute('aria-pressed'), 'false');
  assert.match(h.notices.at(-1), /visit only/);
  h.button('A1').click();
  assert.equal(h.button('A1').getAttribute('aria-pressed'), 'true');
  assert.equal(h.row('A1').querySelector('textarea').value, 'Original note');
});
