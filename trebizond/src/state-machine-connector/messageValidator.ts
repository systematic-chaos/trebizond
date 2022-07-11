/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * state-machine-connector/messageValidator.ts
 */

import { SignedObject,
         checkObjectSignature } from '../trebizond-common/crypto';
import { Operation,
         OpMessage } from '../trebizond-common/datatypes';

export abstract class MessageValidator<Op extends Operation> {

    public validate(message: SignedObject<OpMessage<Op>>, publicKey: string): boolean {
        return this.authenticationValidation(message, publicKey)
            && this.semanticValidation(message.value.operation.operation);
    }

    public authenticationValidation(message: SignedObject<OpMessage<Op>>, publicKey: string): boolean {
        return checkObjectSignature(message, publicKey);
    }

    public abstract semanticValidation(operation: Op): boolean;
}
