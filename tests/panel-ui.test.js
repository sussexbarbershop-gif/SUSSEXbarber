const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../admin/admin.js'),'utf8');
const ui=fs.readFileSync(require.resolve('../admin/panel-ui.js'),'utf8');
const grab=name=>source.match(new RegExp('^(?:async )?function '+name+'\\([\\s\\S]*?^}', 'm'))[0];
const element=tag=>({tag,children:[],dataset:{},disabled:false,textContent:'',
    append(...nodes){this.children.push(...nodes);},prepend(node){this.children.unshift(node);},
    setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},
    addEventListener(name,fn){this[name]=fn;}});
const keys=['bookings','week','services','hours','gallery','cms','barbers','reports'];
const pages=keys.map(key=>({...element('section'),id:'page-'+key}));
const status=element('span'),controls=[element('button'),{...element('select'),disabled:true}];
const scope={...element('form'),querySelector:()=>status,querySelectorAll:()=>controls};
let went,dialogOpen=false,focused=true;
const context=vm.createContext({document:{querySelectorAll:()=>pages,createElement:element,
    querySelector:selector=>selector==='.modal-overlay.active:not([inert]) .modal' ? dialogOpen?scope:null : scope,
    activeElement:{closest:selector=>{assert.equal(selector,'.modal-overlay.active:not([inert]) .modal');return focused?scope:null;}}},navigateTo:p=>{went=p;}});
vm.runInContext(ui,context);
assert(pages.every(p=>p.children[0].className==='panel-page-nav'));
assert.equal(pages[0].children[0].children[0].href,'/');
pages[3].children[0].children[0].click();assert.equal(went,'bookings');
for(const i of [3,4]) assert.match(pages[i].children[0].children[1].textContent,/automatically/);
const finish=vm.runInContext('beginPanelSave()',context);
assert(controls.every(c=>c.disabled));assert.equal(status.textContent,'Saving…');
finish(false);assert.match(status.textContent,/Not saved/);assert.equal(controls[0].disabled,false);assert.equal(controls[1].disabled,true);
vm.runInContext('beginPanelSave()',context)(true);assert.equal(status.textContent,'Saved');
focused=false;dialogOpen=true;
const mobileFinish=vm.runInContext('beginPanelSave()',context);assert.equal(scope['aria-busy'],'true');mobileFinish(true);
console.log('PASS shared navigation, explicit autosave wording, failure feedback and disabled-state restoration');
(async()=>{
    let accepted=false,closed=0,rendered=0;
    const values={svcId:'1',svcNameEN:'New cut',svcNameNL:'Nieuw',svcPrice:'25',svcDuration:'45'};
    const ctx=vm.createContext({document:{getElementById:id=>({value:values[id]})},
        saveToServer:async()=>accepted,showToast(){},closeServiceModal(){closed++;},renderServices(){rendered++;}});
    vm.runInContext('let services=[{id:1,nameEN:"Old cut",nameNL:"Oud",price:20,duration:30}];'+grab('saveServices')+'\n'+grab('handleServiceSubmit'),ctx);
    await vm.runInContext('handleServiceSubmit({preventDefault(){}})',ctx);
    assert.equal(closed,0);assert.equal(rendered,0);assert.equal(vm.runInContext('services[0].nameEN',ctx),'Old cut');
    accepted=true;await vm.runInContext('handleServiceSubmit({preventDefault(){}})',ctx);
    assert.equal(closed,1);assert.equal(rendered,1);assert.equal(vm.runInContext('services[0].nameEN',ctx),'New cut');
    console.log('PASS refused service saves retain the draft and saved list; confirmed saves close once');
})().catch(e=>{console.error(e);process.exitCode=1;});
