// Turns an error from OBS, VTube Studio, Spotify or the other PC into one sentence saying what went wrong and what to
// do. Only a reason that could follow a partial action keeps the "check before pressing again" warning.
const UNKNOWN=' It may already have happened; check the target app before pressing again.';
// "Peer connection timeout" is the TLS connect to the other PC timing out (as a firewall dropping it does): no request
// was sent yet.
const unreachable=/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EADDRNOTAVAIL|Peer connection timeout/;
export function explain(e,app){
 if(e?.publicMessage)return e.publicMessage;
 const message=String(e?.message||e||'').trim().replace(/\.$/,'');const code=String(e?.code??'');
 if(unreachable.test(code)||unreachable.test(message))return app==='the other PC'
  ?'Could not reach the other PC. Make sure VTube Input Bridge is running there with controls enabled, that both PCs are on the network, and that Windows Firewall on the other PC allows VTube Input Bridge on private networks (TCP 5056).'
  :app==='Meld Studio'?'Could not connect to Meld Studio. Make sure Meld Studio is open with Settings > Advanced > Allow remote connections turned on, and check the address in settings.'
  :`Could not connect to ${app}. Make sure ${app} is open and its API is turned on, and check the address in settings.`;
 // The pinned certificate no longer matches: the other PC was reinstalled or its settings reset. Nothing was sent.
 if(/Peer certificate mismatch/.test(message))return 'The other PC is no longer the one this PC was paired with (it was reinstalled or reset). Export its pairing file again and import it on this PC.';
 if(code==='4009'||/authentication failed/i.test(message))return `${app} rejected the password. Re-enter the ${app} WebSocket password in settings.`;
 if(!message)return `${app} failed for an unknown reason.${UNKNOWN}`;
 return /outcome unknown/i.test(message)?`${app}: ${message}.${UNKNOWN}`:`${app}: ${message}.`;
}
// Rethrows from `fn` with the explanation attached; the original error code is kept when it is a short text code.
export async function describing(app,fn){
 try{return await fn();}
 catch(e){const error=new Error(explain(e,app));error.publicMessage=error.message;error.code=typeof e?.code==='string'&&/^[a-z_]+$/.test(e.code)?e.code:'action_failed';throw error;}
}
// An error whose message is already safe and complete to show, such as a missing setting.
export function userError(message,code='invalid_request'){const e=new Error(message);e.publicMessage=message;e.code=code;return e;}
