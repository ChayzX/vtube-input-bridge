// Each PC is shown by its Windows computer name, its role and its address, e.g. "CHASEBOT · Gaming PC · 10.0.0.112".
// The other PC's name arrives over the link (bridge.status) or from its pairing file; an older version sends neither,
// and then only the role and address are shown.
export const roleLabel=role=>role==='canada'?'Streaming PC':'Gaming PC';
// A computer name is display text only: no control characters, at most 63 characters.
export function cleanHostname(value){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,63):'';}
export function pcLabel({hostname,role,ip}={}){return [cleanHostname(hostname),roleLabel(role),ip].filter(Boolean).join(' · ');}
// The newest name wins: what the other PC says now, else what it said before, else its pairing file's.
export function peerHostname(statusData,known,stored){return cleanHostname(statusData?.hostname)||cleanHostname(known)||cleanHostname(stored);}
