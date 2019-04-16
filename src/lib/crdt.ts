import {
    Document,
    serializeOperation, deserializeOperation,
    serializeRemotePosition, deserializeRemotePosition
} from '@atom/teletype-crdt';
import Network from './network';

//setup peer to peer connection
const net = new Network();
net.onRemoteEdit(onRemteChange);

export async function onLocalChange(){

}

export async function onRemteChange(){

}
