import sha2 = require('crypto-js/sha256');
import aes = require('crypto-js/aes');
import utf8 = require('crypto-js/enc-utf8');
import nacl = require('tweetnacl-util');

export function generateSignedDigestFromText(text: string, key: string): Uint8Array {
    return encryptText(hashText(text), key);
}

export function generateSignedDigestFromBytes(bytes: Uint8Array, key: string): Uint8Array {
    return encryptText(hashBytes(bytes), key);
}

export function generateSignedDigestFromObject(object: Object, key: string): Uint8Array {
    return encryptText(hashObject(object), key);
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

export function signObject(object: Object, key: string): SignedObject {
    return {
        value: object,
        signature: generateSignedDigestFromObject(object, key)
    };
}

export function checkTextSignature(signedtext: SignedText, key: string): boolean {
    return hashText(signedtext.value) == decryptText(signedtext.signature, key);
}

export function checkBytesSignature(signedbytes: SignedBytes, key: string): boolean {
    return hashBytes(signedbytes.value) == decryptText(signedbytes.signature, key);
}

export function checkObjectSignature(signedobject: SignedObject, key: string): boolean {
    return hashObject(signedobject.value) == decryptText(signedobject.signature, key);
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

export interface SignedObject extends Signed {
    value: Object;
}

export function encryptText(text: string, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(text, key).toString());
}

export function encryptBytes(bytes: Uint8Array, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(nacl.encodeUTF8(bytes), key).toString());
}

export function encryptObject(object: Object, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(JSON.stringify(object), key).toString());
}

export function decryptText(cipherbytes: Uint8Array, key: string): string {
    return aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8);
}

export function decryptBytes(cipherbytes: Uint8Array, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8));
}

export function decryptObject(cipherbytes: Uint8Array, key: string): Object {
    return JSON.parse(aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8));
}

export function hashText(text: string): string {
    return sha2(text).toString();
}

export function hashBytes(bytes: Uint8Array): string {
    return sha2(nacl.encodeUTF8(bytes)).toString();
}

export function hashObject(object: Object): string {
    return sha2(JSON.stringify(object)).toString();
}

export class Cipher {
    
    private key: string;

    constructor(privatekey: string) {
        this.key = privatekey;
    }

    public generateSignedDigestFromText(text: string): Uint8Array {
        return generateSignedDigestFromText(text, this.key);
    }

    public generateSignedDigestFromBytes(bytes: Uint8Array, key: string): Uint8Array {
        return generateSignedDigestFromBytes(bytes, this.key);
    }

    public generateSignedDigestFromObject(object: Object, key: string): Uint8Array {
        return generateSignedDigestFromObject(object, this.key);
    }

    public signText(text: string): SignedText {
        return signText(text, this.key);
    }

    public signBytes(bytes: Uint8Array): SignedBytes {
        return signBytes(bytes, this.key);
    }

    public signObject(object: Object): SignedObject {
        return signObject(object, this.key);
    }

    public decryptText(cipherbytes: Uint8Array): string {
        return decryptText(cipherbytes, this.key);
    }

    public decryptBytes(cipherbytes: Uint8Array): Uint8Array {
        return decryptBytes(cipherbytes, this.key);
    }

    public decryptObject(cipherbytes: Uint8Array): Object {
        return decryptObject(cipherbytes, this.key);
    }
}
