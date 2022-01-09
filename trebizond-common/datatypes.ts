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

import { SignedBytes } from './crypto';

export interface Message {
    type: string;
    from: number;
}

/* These abstract classes implementation is provided by the platform *
 * onto which the consensus algorithm is integrated.                 */
export abstract class Operation {
}

export abstract class Result {
}

export interface TrebizondOperation<Op extends Operation> {
    operation: Op;
    uuid: string;
    timestamp: Date;
}

export interface OpMessage<Op extends Operation> extends Message {
    operation: TrebizondOperation<Op>;
}

export interface LeadershipVote extends Message {
    type: 'LeadershipVote';
    vote: number;
    epoque: number;
}

export interface LeaderConfirmation extends Message {
    type: 'LeaderConfirmation';
    leader: LeadershipVote;
    votes: Array<SignedBytes>; // Other replicas' leadership votes hashes
}

export interface OperationRequest<Op extends Operation> extends OpMessage<Op> {
    type: 'OperationRequest';
    origen: number;
    broadcast: boolean;
}

export interface TrebizondResult<R extends Result> {
    result: R;
    opUuid: string;
}

export interface SingleReply<R extends Result> extends Message {
    type: 'SingleReply';
    result: TrebizondResult<R>;
}

export interface CollectiveReply<R extends Result> extends Message {
    type: 'CollectiveReply';
    result: TrebizondResult<R>;
    resultAcknowledgments: Array<SignedBytes>; // Other replicas' results hashes
}

export interface Accusation extends Message {
    type: 'Accusation';
}

export interface Init<Op extends Operation> extends OpMessage<Op> {
    type: 'Init';
    currentStatus: Uint8Array; // status digest
}

export interface Echo<Op extends Operation> extends OpMessage<Op> {
    type: 'Echo';
    currentStatus: Uint8Array; // status digest
}

export interface Ready<Op extends Operation> extends OpMessage<Op> {
    type: 'Ready';
    currentStatus: Uint8Array; // status digest
}
