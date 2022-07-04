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

import { SignedText,
         SignedObject } from './crypto';

export interface Message {
    type: string;
    from: number;
}

export interface Envelope<M extends Message> {
    ids: string[];
    type: string;
    serialUUID: string;
    msg: SignedObject<M>;
}

/* These abstract classes implementation is provided by the platform *
 * onto which the consensus algorithm is integrated.                 */
export abstract class Operation {
    public abstract isReadOperation(): boolean;
}

export abstract class Result {
}

export interface TrebizondOperation<Op extends Operation> {
    operation: Op;
    uuid: string;
    timestamp: Date;
    broadcast: boolean;
}

export interface OpMessage<Op extends Operation> extends Message {
    operation: TrebizondOperation<Op>;
}

export interface SignedOpMessage<Op extends Operation> extends Message {
    operation: SignedObject<OpMessage<Op>>;
}

export interface LeaderRedirection extends Message {
    type: 'LeaderRedirection';
    leader: number;
}

export interface LeadershipVote extends Message {
    type: 'LeadershipVote';
    vote: number;
    epoque: number;
}

export interface LeaderConfirmation extends Message {
    type: 'LeaderConfirmation';
    leader: LeadershipVote;
    votes: Map<number, Uint8Array>; // Other replicas' leadership votes hashes
}

export interface TrebizondResult<R extends Result> {
    result: R;
    opUuid: string;
}

export interface SingleReply<R extends Result> extends Message {
    type: 'SingleReply';
    result: SignedObject<TrebizondResult<R>>;
}

export interface CollectiveReply<R extends Result> extends Message {
    type: 'CollectiveReply';
    result: TrebizondResult<R>;
    resultAcknowledgments: Map<number, Uint8Array>; // Replicas' result signed hashes
}

export interface Accusation<Op extends Operation> extends Message {
    type: 'Accusation';
    message: SignedObject<OpMessage<Op>>;
}

export interface Init<Op extends Operation> extends SignedOpMessage<Op> {
    type: 'Init';
    currentStatus: string; // status digest
}

export interface Echo<Op extends Operation> extends SignedOpMessage<Op> {
    type: 'Echo';
    currentStatus: string; // status digest
}

export interface Ready<Op extends Operation> extends SignedOpMessage<Op> {
    type: 'Ready';
    currentStatus: string; // status digest
}

export interface AtomicBroadcastMessageLog<Op extends Operation, R extends Result> {
    init:  Map<number, Init<Op>>,
    echo:  Map<number, Echo<Op>>,
    ready: Map<number, Ready<Op>>,
    accepted: Array<string>,
    replies:  Map<number, SingleReply<R>> | CollectiveReply<R>
}

export interface Reply extends Message {
    serialUUID?: string;
}
