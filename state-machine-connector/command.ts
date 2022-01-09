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

export abstract class StateMachine<Op extends Operation, R extends Result> {

    public abstract executeOperation(operation: Op): Promise<R>;

    public abstract applyOperation(operation: Op, callback: (result: R) => any): void;

    public abstract getSnapshot(): any;

    public abstract setSnapshot(snapshot: any): void;
}
