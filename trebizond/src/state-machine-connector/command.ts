/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * state-machine-connector/command.ts
 */

import { Operation,
         Result } from '../trebizond-common/datatypes';
import { MessageValidator } from '../state-machine-connector/messageValidator';
import { SignedObject,
         hashText,
         signObject } from '../trebizond-common/crypto';

export abstract class StateMachine<Op extends Operation, R extends Result> {

    protected msgValidator: MessageValidator<Op>;

    constructor(msgValidator: MessageValidator<Op>) {
        this.msgValidator = msgValidator;
    }

    public abstract executeOperation(operation: Op): Promise<R>;

    public abstract applyOperation(operation: Op, callback: (result: R) => any): void;

    public abstract getSnapshot(): any;

    public abstract setSnapshot(snapshot: any): void;

    public getMessageValidator(): MessageValidator<Op> {
        return this.msgValidator;
    }

    public isReadOperation(operation: Op): boolean {
        return operation.isReadOperation();
    }
}

export class BlockChain<Op extends Operation, R extends Result> {

    private log: Array<SignedObject<Block<Op, R>>> = [];
    
    public getBlockchainLog(): Array<SignedObject<Block<Op, R>>> {
        return this.log;
    }

    public generateNextBlock(operation: Op, result: R): Block<Op, R> {
        return {
            operation: operation,
            resultingStatus : result,
            previousBlockHash: this.log.length > 0 ?
                hashText(JSON.stringify(this.log[this.log.length - 1]).toString())
                : null
        };
    }

    public appendNextBlock(operation: Op, result: R, privateKey: string): SignedObject<Block<Op, R>> {
        var signedBlock =
            signObject(this.generateNextBlock(operation, result), privateKey) as SignedObject<Block<Op, R>>;
        this.getBlockchainLog().push(signedBlock);
        return signedBlock;
    }
}

export interface Block<Op extends Operation, R extends Result> {
    operation: Op;
    resultingStatus: R;
    previousBlockHash: string | null;
}