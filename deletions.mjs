import {clone,validateState,ledgerForMonth,sourceItemAmounts,reimbursementForExpense,splitReimbursement,monthDate,itemPaidTotal,restoreEvent,refreshPayrollForecasts,sourceIncludedAmount} from './finance.mjs';

const monthOf=e=>e.month||e.date?.slice(0,7);
const isLegacyBill=e=>e.source==='source'&&['invoice','installments','settlement','agreement'].includes(e.kind);
export const canDeleteEvent=e=>!!e&&!isLegacyBill(e)&&e.reimbursementChildren===undefined;

// Work on a copy: the caller reviews the net cash effect before saving anything.
export function prepareDeletion(state,target){
 validateState(state);let s=clone(state);
 const events=new Set(),purchases=new Set(),history=new Set(),rows=new Map();let description='',scope='Somente este lançamento';
 const addRow=row=>{if(row)rows.set(`${monthOf(row)}:${row.id}`,row)};
 const event=s.events.find(e=>e.id===target?.id);
 if(target?.kind==='purchase'||target?.kind==='event'&&event?.purchaseId&&event.direction==='out'){
  const p=s.purchases.find(p=>p.id===(event?.purchaseId||target.id));if(!p)throw new Error('Lançamento não encontrado.');
  purchases.add(p.id);description=p.description;scope=p.installments>1?'A compra inteira, todas as parcelas e seu reembolso vinculado':'A compra e seu reembolso vinculado';
  for(const e of s.events.filter(e=>e.purchaseId===p.id))events.add(e.id);
  if(!p.void){if(['Pix','Dinheiro'].includes(p.payment))s.settings.balance+=p.amount;else if(['VR','VA'].includes(p.payment)&&s.settings.benefits[p.payment]!==null)s.settings.benefits[p.payment]+=p.amount;}
 }else if(target?.kind==='event'){
  if(!canDeleteEvent(event))throw new Error('Abra o item em Transações para excluir; esta fatura reúne vários lançamentos.');
  events.add(event.id);description=event.description;
  if(event.kind==='reimbursement'){
   const key=event.purchaseId?'purchase:'+event.purchaseId:event.expenseKey?JSON.stringify([event.expenseKey,event.expenseMonth,event.person]):null;
   if(key)s.settings.suppressedRefunds=[...new Set([...(s.settings.suppressedRefunds||[]),key])];
  }
  addRow(ledgerForMonth(s,monthOf(event)).find(r=>r.eventId===event.id||r.paymentEventId===event.id));
  const sourceNumber=event.kind==='fixed'&&event.id.match(/^fixed-current-(\d+)$/)?.[1];
  if(sourceNumber){const original=s.history.find(r=>String(r.row)===sourceNumber);if(original)history.add(original.id);}
 }else if(target?.kind==='source'){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(target.month||''))throw new Error('Selecione o mês do lançamento.');
  const row=ledgerForMonth(s,target.month,{type:'expense'}).find(r=>r.id===target.id);if(!row||!['source','source-projection'].includes(row.origin))throw new Error('Lançamento não encontrado.');
  description=row.description;addRow(row);
  if(row.origin==='source'){
   history.add(row.id);const last=s.settings.sourceProjectionMonth||s.history.map(r=>r.month).sort().at(-1);
   if(row.type==='expense'&&row.part&&row.parts>row.part&&row.month===last){
    if(row.parts-row.part>600)throw new Error('Confira a quantidade de parcelas antes de excluir.');
    scope='Este item da planilha e todas as suas parcelas futuras';
    for(let i=1;i<=row.parts-row.part;i++){const month=monthDate(row.month+'-01',i).slice(0,7);addRow(ledgerForMonth(s,month,{type:'expense'}).find(r=>r.sourceId===row.id));}
   }
  }else scope='Somente a parcela deste mês; as outras parcelas serão mantidas';
 }else throw new Error('Escolha um lançamento para excluir.');

 // Split a still-pending legacy settlement only when its total matches exactly.
 for(const parent of [...s.events])if(parent.kind==='reimbursement'&&parent.source==='source'&&!parent.expenseKey&&!parent.purchaseId&&parent.status==='planned'&&parent.date&&[...rows.values()].some(r=>r.person===parent.person&&monthOf(r)===monthDate(parent.date,-1).slice(0,7)))s=splitReimbursement(s,parent.id);
 for(const row of rows.values()){
  const receipt=reimbursementForExpense(s,row);if(receipt)events.add(receipt.id);
  const key=row.paymentEventId&&s.events.find(e=>e.id===row.paymentEventId)?.kind==='fixed'?row.paymentEventId:row.eventId||row.id;
  for(const e of s.events)if(e.kind==='reimbursement'&&e.expenseKey===key&&e.expenseMonth===monthOf(row))events.add(e.id);
 }
 for(const e of s.events)if(e.kind==='reimbursement'&&events.has(e.expenseKey))events.add(e.id);

 // Remove only selected invoice items, preserving other items' cents and payments.
 const groups=new Map();
 for(const row of rows.values())if(['source','source-projection'].includes(row.origin)){
  const e=s.events.find(e=>e.id===row.paymentEventId);if(!e)continue;
  if(e.kind==='fixed'){events.add(e.id);continue;}
  if(!groups.has(e.id))groups.set(e.id,{event:e,removed:new Map(),all:new Map()});
  const g=groups.get(e.id);for(const [key,value] of sourceItemAmounts(s,row.month))if(value.eventId===e.id)g.all.set(key,value.amount);
  const amount=g.all.get(row.id);if(amount===undefined)throw new Error('Não foi possível identificar o valor do item na fatura.');g.removed.set(row.id,{row,amount});
 }
 for(const {event:e,removed,all} of groups.values()){
  const removedTotal=[...removed.values()].reduce((n,r)=>n+r.amount,0);if(removedTotal>e.amount)throw new Error('Os itens não conferem com a fatura. Confira na Agenda antes de excluir.');
  const cash=[...removed].reduce((n,[key,{row,amount}])=>n+(e.itemPayments?.find(p=>p.key===key)?.amount||(e.status==='paid'&&(row.sourceStatus!=='Pago'||e.applied===-e.amount)?amount:0)),0);
  e.amount-=removedTotal;s.settings.balance+=cash;e.applied=(e.applied||0)+cash;
  if(e.amount===0){events.add(e.id);continue;}
  e.sourceItemAmounts=Object.fromEntries([...all].filter(([key])=>!removed.has(key)));
  e.itemPayments=(e.itemPayments||[]).filter(p=>!removed.has(p.key));if(!e.itemPayments.length)delete e.itemPayments;
 }
 const excluded=[...rows.values()].filter(row=>row.origin==='source-projection'&&!history.has(row.sourceId)).map(row=>row.id);
 if(excluded.length)s.settings.excludedSourceItems=[...new Set([...(s.settings.excludedSourceItems||[]),...excluded])];
 const receipts=s.events.filter(e=>events.has(e.id)&&e.kind==='reimbursement').length;
 for(const id of events){
  const e=s.events.find(e=>e.id===id);if(!e)continue;
  if(e.kind==='salary'&&s.events.some(loan=>loan.payrollAutoSalaryId===id))s=restoreEvent(s,id);
  else s.settings.balance-=e.applied||0;
 }
 s.events=s.events.filter(e=>!events.has(e.id));s.purchases=s.purchases.filter(p=>!purchases.has(p.id));
 if(history.size){s.settings.sourceProjectionMonth??=s.history.map(r=>r.month).sort().at(-1);s.history=s.history.filter(r=>!history.has(r.id));}
 for(const id of groups.keys()){
  const e=s.events.find(e=>e.id===id);if(!e||!['planned','deferred'].includes(e.status))continue;
  const paid=itemPaidTotal(e),included=sourceIncludedAmount(s,e);
  if(paid+included===e.amount){e.previousStatus??=e.status;e.status=paid?'paid':'covered';if(paid)e.paidDate=e.itemPayments.at(-1).paidDate;}
 }
 for(const parent of [...s.events].filter(e=>e.reimbursementChildren)){
  parent.reimbursementChildren=parent.reimbursementChildren.filter(id=>s.events.some(e=>e.id===id));
  if(!parent.reimbursementChildren.length)s.events=s.events.filter(e=>e.id!==parent.id);
  else parent.amount=parent.reimbursementChildren.reduce((n,id)=>n+s.events.find(e=>e.id===id).amount,0);
 }
 refreshPayrollForecasts(s);validateState(s);
 return {state:s,description,scope,receipts,balanceChange:s.settings.balance-state.settings.balance,removedEvents:state.events.length-s.events.length,removedPurchases:purchases.size,removedHistory:history.size};
}
