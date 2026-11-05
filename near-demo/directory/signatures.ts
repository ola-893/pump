import {ed25519} from '@noble/curves/ed25519';
import {base58} from '@scure/base';
import {createHash} from 'node:crypto';
import {canonical} from '../ledger.js';

export function publicKeyBytes(key:string){
 if(typeof key!=='string'||!key.startsWith('ed25519:'))throw new Error('An Ed25519 public key is required.');
 const bytes=base58.decode(key.slice(8));
 if(bytes.length!==32)throw new Error('Invalid Ed25519 public key length.');
 return bytes;
}
export function verifySignature(key:string,message:Uint8Array,signature:Uint8Array){
 try{return signature.length===64&&ed25519.verify(signature,message,publicKeyBytes(key));}
 catch{return false;}
}
export function publicationHash(payload:unknown){
 return createHash('sha256').update('PUMP-DIRECTORY-UPDATE-v1\0'+canonical(payload)).digest();
}
export function nep413Hash(message:string,nonce:string,recipient:string){
 const string=(value:string)=>{const b=Buffer.from(value),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};
 const tag=Buffer.alloc(4);tag.writeUInt32LE(2**31+413);
 const bytes=Buffer.from(nonce,'base64');if(bytes.length!==32)throw new Error('Invalid challenge nonce.');
 return createHash('sha256').update(Buffer.concat([tag,string(message),bytes,string(recipient),Buffer.from([0])])).digest();
}
