/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-common/crypto.ts
 */

import sha2 from 'crypto-js/sha256';
import aes from 'crypto-js/aes';
import utf8 from 'crypto-js/enc-utf8';
import nacl from 'tweetnacl-util';

export function generateSignedDigestFromText(text: string, key: string): Uint8Array {
    return encryptText(hashText(text), key);
}

export function generateSignedDigestFromBytes(bytes: Uint8Array, key: string): Uint8Array {
    return encryptText(hashBytes(bytes), key);
}

export function generateSignedDigestFromObject(obj: object, key: string): Uint8Array {
    return encryptText(hashObject(obj), key);
}

export function signText(text: string, key: string): SignedText {
    return {
        value: text,
        signature: generateSignedDigestFromText(text, key)
    };
}

export function signBytes(bytes: Uint8Array, key: string): SignedBytes {
    return {
        value: bytes,
        signature: generateSignedDigestFromBytes(bytes, key)
    };
}

export function signObject(obj: object, key: string): SignedObject<object> {
    return {
        value: obj,
        signature: generateSignedDigestFromObject(obj, key)
    };
}

export function checkTextSignature(signedtext: SignedText, key: string): boolean {
    return hashText(signedtext.value) === decryptText(signedtext.signature, key);
}

export function checkBytesSignature(signedbytes: SignedBytes, key: string): boolean {
    return hashBytes(signedbytes.value) === decryptText(signedbytes.signature, key);
}

export function checkObjectSignature(signedobject: SignedObject<object>, key: string): boolean {
    return hashObject(signedobject.value) === decryptText(signedobject.signature, key);
}

interface Signed {
    signature: Uint8Array;
}

export interface SignedText extends Signed {
    value: string;
}

export interface SignedBytes extends Signed {
    value: Uint8Array;
}

export interface SignedObject<O extends object> extends Signed {
    value: O;
}

export function encryptText(text: string, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(text, key).toString());
}

export function encryptBytes(bytes: Uint8Array, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(nacl.encodeUTF8(bytes), key).toString());
}

export function encryptObject(obj: object, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(JSON.stringify(obj), key).toString());
}

export function decryptText(cipherbytes: Uint8Array, key: string): string {
    return aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8);
}

export function decryptBytes(cipherbytes: Uint8Array, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8));
}

export function decryptObject(cipherbytes: Uint8Array, key: string): object {
    return JSON.parse(aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8));
}

export function hashText(text: string): string {
    return sha2(text).toString();
}

export function hashBytes(bytes: Uint8Array): string {
    return sha2(nacl.encodeUTF8(bytes)).toString();
}

export function hashObject(obj: object): string {
    return sha2(JSON.stringify(obj)).toString();
}

export class Cipher {

    private key: string;

    constructor(privatekey: string) {
        this.key = privatekey;
    }

    public generateSignedDigestFromText(text: string): Uint8Array {
        return generateSignedDigestFromText(text, this.key);
    }

    public generateSignedDigestFromBytes(bytes: Uint8Array): Uint8Array {
        return generateSignedDigestFromBytes(bytes, this.key);
    }

    public generateSignedDigestFromObject(obj: object): Uint8Array {
        return generateSignedDigestFromObject(obj, this.key);
    }

    public signText(text: string): SignedText {
        return signText(text, this.key);
    }

    public signBytes(bytes: Uint8Array): SignedBytes {
        return signBytes(bytes, this.key);
    }

    public signObject(obj: object): SignedObject<object> {
        return signObject(obj, this.key);
    }

    public decryptText(cipherbytes: Uint8Array): string {
        return decryptText(cipherbytes, this.key);
    }

    public decryptBytes(cipherbytes: Uint8Array): Uint8Array {
        return decryptBytes(cipherbytes, this.key);
    }

    public decryptObject(cipherbytes: Uint8Array): object {
        return decryptObject(cipherbytes, this.key);
    }
}
