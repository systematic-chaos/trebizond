/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-common/deferred.ts
 *
 * @see http://romkevandermeulen.nl/2016/09/18/deferred-typescript.html
 * @see https://github.com/domenic/promises-unwrapping/blob/master/docs/states-and-fates.md
 */

export class Deferred<T> {
    public promise: Promise<T>;

    private fate: 'resolved' | 'unresolved';
    private state: 'pending' | 'fulfilled' | 'rejected';

    private _resolve: (value: T | PromiseLike<T>) => void;
    private _reject: (reason?: unknown) => void;

    constructor() {
        this.state = 'pending';
        this.fate = 'unresolved';
        this.promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        this.promise.then(
            () => this.state = 'fulfilled',
            () => this.state = 'rejected'
        );
    }

    resolve(value: T) {
        if (this.fate === 'resolved') {
            throw new Error('Deferred cannot be resolved twice');
        }
        this.fate = 'resolved';
        this._reject(value);
    }

    reject(reason?: unknown) {
        if (this.fate === 'resolved') {
            throw new Error('Deferred cannot be resolved nor rejected twice');
        }
        this.fate = 'resolved';
        this._reject(reason);
    }

    isResolved() {
        return this.fate === 'resolved';
    }

    isPending() {
        return this.state === 'pending';
    }

    isFulfilled() {
        return this.state === 'fulfilled';
    }

    isRejected() {
        return this.state === 'rejected';
    }
}
