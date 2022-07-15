/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-common/datatypes.ts
 */

import { SignedObject } from './crypto';

interface Message {
    type: string;
    from: number;
}

interface Envelope<M extends Message> {
    ids: string[];
    type: string;
    serialUUID: string;
    msg: SignedObject<M>;
}

/* These abstract classes implementation is provided by the platform *
 * onto which the consensus algorithm is integrated.                 */
interface Operation {
    isReadOperation(): boolean;
}

interface TrebizondOperation<Op extends Operation> {
    operation: Op;
    uuid: string;
    timestamp: Date;
    broadcast: boolean;
}

interface OpMessage<Op extends Operation> extends Message {
    operation: TrebizondOperation<Op>;
}

interface SignedOpMessage<Op extends Operation> extends Message {
    operation: SignedObject<OpMessage<Op>>;
}

interface LeaderRedirection extends Message {
    type: 'LeaderRedirection';
    leader: number;
}

interface LeadershipVote extends Message {
    type: 'LeadershipVote';
    vote: number;
    epoque: number;
}

interface LeaderConfirmation extends Message {
    type: 'LeaderConfirmation';
    leader: LeadershipVote;
    votes: Record<number, Uint8Array>; // Other replicas' leadership votes hashes
}

interface TrebizondResult<R> {
    result: R;
    opUuid: string;
}

interface SingleReply<R> extends Message {
    type: 'SingleReply';
    result: SignedObject<TrebizondResult<R>>;
}

interface CollectiveReply<R> extends Message {
    type: 'CollectiveReply';
    result: TrebizondResult<R>;
    resultAcknowledgments: Record<number, Uint8Array>; // Replicas' result signed hashes
}

interface Accusation<Op extends Operation> extends Message {
    type: 'Accusation';
    message: SignedObject<OpMessage<Op>>;
}

interface Init<Op extends Operation> extends SignedOpMessage<Op> {
    type: 'Init';
    currentStatus: string; // status digest
}

interface Echo<Op extends Operation> extends SignedOpMessage<Op> {
    type: 'Echo';
    currentStatus: string; // status digest
}

interface Ready<Op extends Operation> extends SignedOpMessage<Op> {
    type: 'Ready';
    currentStatus: string; // status digest
}

interface AtomicBroadcastMessageLog<Op extends Operation, R> {
    init:  Record<number, Init<Op>>,
    echo:  Record<number, Echo<Op>>,
    ready: Record<number, Ready<Op>>,
    accepted: Array<string>,
    replies:  Record<number, SingleReply<R>> | CollectiveReply<R>
}

interface Reply extends Message {
    serialUUID?: string;
}

export { Message, Envelope,
    Operation, TrebizondOperation, OpMessage, SignedOpMessage,
    LeaderRedirection, LeadershipVote, LeaderConfirmation,
    TrebizondResult, Reply, SingleReply, CollectiveReply,
    Accusation, Init, Echo, Ready, AtomicBroadcastMessageLog };
