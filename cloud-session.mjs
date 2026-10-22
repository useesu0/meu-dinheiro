import {createCloudStore} from './cloud-store.mjs';

export function createAccessGate(){
 let generation=0,user=null,store=null;
 return {set(nextUser,nextStore){generation++;user=nextUser;store=nextStore;},async run(method,...args){
   if(!user||!store)throw new Error('Faça login na sua conta Google para acessar o controle.');
   const started=generation,result=await store[method](...args);
   if(started!==generation)throw new Error('A sessão mudou. Entre na conta novamente antes de continuar.');
   return result;
 }};
}
export function cloudMessage(error){
 if(String(error?.code).includes('permission-denied'))return 'Esta conta não tem acesso ao controle online. Entre na conta pessoal autorizada.';
 if(String(error?.code).includes('popup-blocked'))return 'O navegador bloqueou a janela de login. Toque em Entrar novamente e permita a janela do Google.';
 if(String(error?.code).includes('popup-closed')||String(error?.code).includes('cancelled-popup'))return 'Login cancelado. Seus dados não foram alterados.';
 if(String(error?.code).includes('unavailable')||String(error?.code).includes('network')||String(error?.message).includes('offline'))return 'Sem conexão com a nuvem. Nada foi confirmado como salvo. Tente novamente com internet.';
 return error?.message||'Não foi possível acessar a nuvem. Tente novamente.';
}
export function createCloudSession({sdk,config,onChange}){
 const gate=createAccessGate();let auth,db,info={ready:false,user:null,error:''};
 const emit=next=>{info=next;onChange({...info});};
 const initialize=(async()=>{
  try{
   if(!sdk?.auth||!sdk?.firestore)throw new Error('O programa de acesso à nuvem não carregou. Reabra o aplicativo com internet.');
   const app=sdk.apps.find(a=>a.name==='meu-dinheiro')||sdk.initializeApp(config,'meu-dinheiro');auth=app.auth();db=app.firestore();
   // Web Firestore uses memory cache by default. Never enable IndexedDB persistence.
   db.settings({experimentalAutoDetectLongPolling:true,merge:true});
   // Authentication session only; financial records never use this persistence.
   await auth.setPersistence(sdk.auth.Auth.Persistence.LOCAL);
   auth.onAuthStateChanged(user=>{
    const identity=user?{uid:user.uid,email:user.email||'',name:user.displayName||''}:null;
    const collection=identity?db.collection('users').doc(identity.uid).collection('control'):null;
    const driver={transaction:async operation=>{
     if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('offline');
     return db.runTransaction(async tx=>operation({get:async key=>{const snap=await tx.get(collection.doc(key));return snap.exists?snap.data():null;},set:(key,value)=>tx.set(collection.doc(key),value),delete:key=>tx.delete(collection.doc(key))}),{maxAttempts:3});
    }};
    gate.set(identity,identity?createCloudStore(driver):null);emit({ready:true,user:identity,error:''});
   },error=>{gate.set(null,null);emit({ready:true,user:null,error:cloudMessage(error)});});
  }catch(error){gate.set(null,null);emit({ready:true,user:null,error:cloudMessage(error)});}
 })();
 return {
  getInfo:()=>({...info}),
  login(){if(!auth||!info.ready)throw new Error('Aguarde o carregamento do login.');const provider=new sdk.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});return auth.signInWithPopup(provider);},
  async logout(){await initialize;gate.set(null,null);emit({ready:true,user:null,error:''});await auth.signOut();},
  readControl:()=>gate.run('readControl'),writeControl:(state,revision)=>gate.run('writeControl',state,revision),previousControl:()=>gate.run('previousControl')
 };
}
