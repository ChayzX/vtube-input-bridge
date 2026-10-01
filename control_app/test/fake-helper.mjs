// Stands in for VTubeInputBridge.exe --headless in tests, speaking the same line protocol.
// FAKE_HELPER=crash exits right after its first status; FAKE_HELPER=fatal reports the window lock and exits.
import {createInterface} from 'node:readline';
const mode=process.env.FAKE_HELPER||'normal';
const state={type:'status',running:false,packets:0,error:'',destination:process.env.FAKE_DESTINATION||'10.0.0.119',gameMode:false,sensitivity:1,rawEvents:0,rawError:'',legacy:false};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(mode==='fatal'){emit({type:'fatal',message:'The VTube Input Bridge window is already sending on this PC.'});process.exit(3);}
emit(state);
if(mode==='crash')setTimeout(()=>process.exit(1),20);
createInterface({input:process.stdin}).on('line',line=>{
 const [command,...args]=line.trim().split(' ');
 if(command==='start'){state.running=true;state.destination=args[0];}
 else if(command==='stop')state.running=false;
 else if(command==='mouse'){state.gameMode=args[0]==='game';state.sensitivity=Number(args[1]);}
 else if(command!=='status')emit({type:'error',message:'Unknown command: '+command});
 emit(state);
}).on('close',()=>process.exit(0));
