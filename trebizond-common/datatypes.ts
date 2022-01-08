import { SignedBytes } from "./crypto";

/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * trebizond-datatypes/datatypes.ts
 * 
 */

export interface Message {
    type: string;
}

/* These abstract classes implementation is provided by the platform *
 * onto which the consensus algorithm is integrated.                 */
export abstract class Operation {
}

export abstract class Result {
}

export interface TrebizondOperation {
    op: Operation;
    uuid: string;
    timestamp: Date;
}

export interface OpMessage extends Message {
    operation: TrebizondOperation;
    source: number;
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

export interface OperationRequest extends OpMessage {
    type: 'OperationRequest';
    origen: number;
    broadcast: boolean;
}

export interface TrebizondResult {
    result: Result;
    opUuid: string;
}

export interface SingleReply {
    result: TrebizondResult;
}

export interface CollectiveReply extends SingleReply {
    resultAcknowledgments: Array<SignedBytes>; // Other replicas' results hashes
}

export type Accusation = OpMessage;

export interface Init extends OpMessage {
    type: 'Init';
    currentStatus: Uint8Array; // status digest
}

export interface Echo extends OpMessage {
    type: 'Echo';
    currentStatus: Uint8Array; // status digest
}

export interface Ready extends OpMessage {
    type: 'Ready';
    currentStatus: Uint8Array; // status digest
}
