import {ledgerForMonth as rawLedger,monthOverview as rawOverview,payExpenses as rawPay,monthDate,todayBR,historyTotal,groupExpenses,cardsForState,paymentName,paymentsForRows,outstandingAmount,sourceIncludedAmount,detailExpenseRows} from './finance.mjs';
import {buildAnalysisReport as rawReport} from './reports.mjs';
import {isPayrollLoan,itemPaidTotal,previousDay} from './finance.mjs';

const validMonth=month=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'');
const shift=(month,n)=>monthDate(month+'-01',n).slice(0,7);
export function cardFilterLabel(state,card='ALL'){return card==='ALL'?'Todos os lançamentos':card==='ALL_CARDS'?'Todos os cartões':paymentName(state,card);}
function matchesCard(state,row,card='ALL'){
 if(card==='ALL'||!card)return true;
 if(row.type!=='expense')return false;
 const id=row.bankId||row.payment;
 return card==='ALL_CARDS'?cardsForState(state,{includeArchived:true}).some(c=>c.id===id):id===card;
}
const credit=row=>row.type==='expense'&&!(row.origin==='source'||row.origin==='source-projection')&&
 (row.origin==='purchase'&&!['Pix','Dinheiro','VR','VA'].includes(row.payment)||row.origin==='event'&&['card','invoice','installments','agreement','settlement'].includes(row.kind));
// Imported source rows already carry the salary/budget month. Preserve their IDs,
// source month and all cash dates; only new credit rows move in this read model.
export function ledgerForMonth(state,month,filters={}){
 if(!validMonth(month))throw new Error('Selecione um mês de orçamento válido.');
 const rows=[];
 for(const ledgerMonth of [month,shift(month,1)])for(const row of rawLedger(state,ledgerMonth,filters)){
  const budgetMonth=credit(row)&&row.date?shift(row.date.slice(0,7),-1):ledgerMonth;
  if(budgetMonth===month&&matchesCard(state,row,filters.card))rows.push({...row,ledgerMonth,budgetMonth});
 }
 return rows.sort((a,b)=>(b.date||month+'-01').localeCompare(a.date||month+'-01'));
}
export function monthOverview(state,month){
 const overview=rawOverview(state,month),rows=ledgerForMonth(state,month),own=ledgerForMonth(state,month,{type:'expense',person:'JEFFERSON'}).filter(r=>!['VR','VA'].includes(r.payment));
 return {...overview,personalExpenses:historyTotal(own.map(r=>({...r,amount:r.displayAmount,originalAmount:r.isSplit?undefined:r.originalAmount}))),sharedExpenses:historyTotal(rows.filter(r=>r.type==='expense'&&r.person==='Compartilhado')),purchasesCount:new Set(rows.filter(r=>r.origin==='purchase').map(r=>r.purchaseId)).size};
}
function details(rows,title){const amount=historyTotal(rows);return {title,amount,rows:detailExpenseRows(rows,amount)};}
export function cardExpenseDetails(state,month,id){return details(ledgerForMonth(state,month,{type:'expense'}).filter(r=>r.payment===id&&!['VR','VA'].includes(r.payment)),paymentName(state,id));}
export function pixExpenseDetails(state,month){return details(ledgerForMonth(state,month,{type:'expense'}).filter(r=>r.payment==='Pix'&&!r.bankId&&(r.paymentMethod||r.method)!=='Cartão de Débito'),'Pix');}
export function analysisGroups(state,month,mode='category',person='JEFFERSON',filters={}){
 if(!['category','bank','person'].includes(mode))throw new Error('Agrupamento de análise inválido.');
 const rows=ledgerForMonth(state,month,{...filters,type:'expense',person:mode==='person'?'Todos':person}).filter(r=>!['VR','VA'].includes(r.payment));
 const selected=mode==='person'?rows.flatMap(r=>Object.entries(r.shares).filter(([,amount])=>amount!==0).map(([name,amount])=>({...r,expenseCategory:r.category,category:name,analysisPerson:name,amount,originalAmount:r.isSplit?undefined:r.originalAmount}))):
 rows.filter(r=>mode!=='bank'||cardsForState(state,{includeArchived:true}).some(c=>c.id===r.payment)||r.bankId).map(r=>({...r,expenseCategory:r.category,category:mode==='bank'?r.bank:r.category,analysisPerson:!['Todos','ALL'].includes(person)?person:undefined,amount:['Todos','ALL'].includes(person)?r.amount:r.displayAmount,originalAmount:r.isSplit?undefined:r.originalAmount}));
 return groupExpenses(selected).map(g=>({...g,rows:detailExpenseRows(g.rows,g.amount)}));
}
export function buildAnalysisReport(state,month,mode,person,filters={}){const report=rawReport(state,month,mode,person,analysisGroups(state,month,mode,person,filters));return {...report,period:'Orçamento de '+report.period,cardFilter:filters.card||'ALL',cardLabel:cardFilterLabel(state,filters.card)};}
export function cardPaymentDetails(state,month,id){
 if(!validMonth(month)||!cardsForState(state,{includeArchived:true}).some(c=>c.id===id))throw new Error('Confira o cartão e o mês selecionados.');
 const detail=cardExpenseDetails(state,month,id),pending=detail.rows.filter(r=>r.detailAmount>0&&!['paid','covered','void'].includes(r.status)&&r.sourceStatus!=='Pago'),payments=paymentsForRows(state,pending),groups=new Map();
 for(const p of payments)groups.set(p.eventId,(groups.get(p.eventId)||0)+p.amount);
 const blocked=pending.some(r=>!payments.some(p=>p.id===r.id||p.id===r.eventId))||[...groups].some(([eventId,total])=>total!==outstandingAmount(state.events.find(e=>e.id===eventId),state));
 const linked=new Set(detail.rows.map(r=>r.paymentEventId).filter(Boolean)),included=state.events.filter(e=>linked.has(e.id)).reduce((n,e)=>n+sourceIncludedAmount(state,e),0);
 return {...detail,month,cardId:id,pending,payments,blocked,included,total:payments.reduce((n,p)=>n+p.amount,0)};
}
export function payExpenses(state,ids,month,date=todayBR()){
 if(!Array.isArray(ids)||!ids.length)throw new Error('Selecione pelo menos uma despesa pendente.');
 const rows=ledgerForMonth(state,month),eligible=new Map(paymentsForRows(state,rows).map(p=>[p.id,p])),byMonth=new Map();
 for(const id of new Set(ids)){
  const p=eligible.get(id),row=p&&rows.find(r=>r.id===p.id||r.eventId===p.id);
  if(!row)throw new Error('Uma despesa da seleção não pertence a este orçamento ou já foi paga.');
  if(!byMonth.has(row.ledgerMonth))byMonth.set(row.ledgerMonth,[]);byMonth.get(row.ledgerMonth).push(id);
 }
 let next=state;for(const [rawMonth,selected]of byMonth)next=rawPay(next,selected,rawMonth,date);return next;
}
export function payCard(state,month,id,date=todayBR()){
 const d=cardPaymentDetails(state,month,id);if(d.blocked)throw new Error('Os itens não conferem com a fatura. Confira os valores na Agenda.');
 if(!d.payments.length)throw new Error('Não há despesas pendentes deste cartão neste mês.');return payExpenses(state,d.payments.map(p=>p.id),month,date);
}
export function pendingExpensesForMonth(state,month,today=todayBR()){
 if(!validMonth(month))throw new Error('Selecione um mês de orçamento válido.');
 const cards=new Set(cardsForState(state,{includeArchived:true}).map(c=>c.id)),end=previousDay(monthDate(month+'-01',1)),cardEnd=previousDay(monthDate(month+'-01',2));
 const rows=state.events.filter(e=>e.direction==='out'&&['planned','deferred'].includes(e.status)&&!isPayrollLoan(e)&&!['VR','VA'].includes(e.account)).flatMap(e=>{
  const card=cards.has(e.account)&&['card','invoice','installments','agreement','settlement'].includes(e.kind);
  if(e.status!=='deferred'&&e.date&&e.date>(card?cardEnd:end))return [];
  const amount=outstandingAmount(e,state);if(amount<=0)return [];
  return [{...e,amount,fullAmount:e.amount,partialPaid:itemPaidTotal(e),card,overdue:!!e.date&&e.date<today}];
 }).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.description.localeCompare(b.description));
 return {rows,total:rows.reduce((n,e)=>n+e.amount,0),overdueCount:rows.filter(e=>e.overdue).length,undatedCount:rows.filter(e=>!e.date).length};
}
