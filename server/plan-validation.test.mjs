import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanProposal } from './plan-validation.mjs';

const plan = () => ({ project_version: 3, tasks: [
  { id: 'review', title: 'بازبینی', weight: 2, depends_on: ['build'] },
  { id: 'build', title: 'ساخت', weight: 3, depends_on: ['design'] },
  { id: 'design', title: 'طراحی', weight: 1, depends_on: [] },
] });

test('validates and orders user-supplied weighted tasks without implying execution', () => {
  assert.deepEqual(validatePlanProposal(plan()), { valid:true,project_version:3,task_count:3,total_weight:6,topological_order:['design','build','review'] });
  const independent={project_version:1,tasks:[{id:'b',title:'ب',weight:1,depends_on:[]},{id:'a',title:'الف',weight:1,depends_on:[]}]};
  assert.deepEqual(validatePlanProposal(independent).topological_order,['b','a']);
  assert.equal(validatePlanProposal({project_version:1,tasks:[{id:'x',title:'😀'.repeat(100),weight:1,depends_on:[]}]}).valid,true);
});

test('rejects missing, duplicate, unknown, cyclic and self dependencies', () => {
  for (const mutate of [p=>{p.tasks[0].depends_on=['missing'];},p=>{p.tasks[0].depends_on=['build','build'];},
    p=>{p.tasks[0].depends_on=['review'];},p=>{p.tasks[2].depends_on=['review'];},p=>{p.tasks[0].id='build';}]) {
    const p=plan(); mutate(p); assert.equal(validatePlanProposal(p).valid,false);
  }
  const cyclic=plan(); cyclic.tasks[2].depends_on=['review']; assert.equal(validatePlanProposal(cyclic).issue,'tasks.cycle');
});

test('rejects extra control fields, malformed payloads and out-of-range values', () => {
  const cases=[null,[],{}, {project_version:0,tasks:[]}, {project_version:1,tasks:[]},
    {project_version:1,tasks:Array(101).fill(null)}, {...plan(),status:'running'},
    {...plan(),tasks:[{...plan().tasks[0],status:'completed'}]},
    {...plan(),tasks:[{id:'x',title:' ',weight:1,depends_on:[]}]},
    {...plan(),tasks:[{id:'x',title:'\u00a0',weight:1,depends_on:[]}]},
    {...plan(),tasks:[{id:'x',title:'\u0000',weight:1,depends_on:[]}]},
    {...plan(),tasks:[{id:'x',title:'\ud800',weight:1,depends_on:[]}]},
    {...plan(),tasks:[{id:'x',title:'😀'.repeat(101),weight:1,depends_on:[]}]},
    {...plan(),tasks:[{id:'x',title:'x',weight:0,depends_on:[]}]},
    {...plan(),tasks:[{id:'x',title:'x',weight:1001,depends_on:[]}]},
    {...plan(),tasks:[{id:'bad.id',title:'x',weight:1,depends_on:[]}]},
    {...plan(),tasks:[{id:'x',title:'x',weight:1,depends_on:'y'}]},
    {...plan(),tasks:[{id:'x',title:'x',weight:1,depends_on:[],agent:'admin'}]}];
  for(const entry of cases) assert.equal(validatePlanProposal(entry).valid,false);
});
