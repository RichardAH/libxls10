// XLS-10 Token Manipulation Library
// Version: 0.9
// Author: Richard Holland @codetsunami

//todo: verify utf-8 and ascii work correctly

const assert = require('assert').strict;

const sixbit = [
  '\x00',
  'a',    'b',    'c',   'd',
  'e',    'f',    'g',   'h',
  'i',    'j',    'k',   'l',
  'm',    'n',    'o',   'p',
  'q',    'r',    's',   't',
  'u',    'v',    'w',   'x',
  'y',    'z',    '0',   '1',
  '2',    '3',    '4',   '5',
  '6',    '7',    '8',   '9',
  '.',    '-',    '_',   ':',
  '/',    '?',    '#',   '[',
  ']',    '@',    '!',   '$',
  '&',    '(',    ')',   '*',
  "'",    '+',    ',',   ';',
  '=',    '~',    '%',   '\\',
  '.com', '.org', '.io'
]

function replaceAt(s, index, char) {
    return s.substr(0,index) + char + s.substr(index+1)
}


class XLS10Token {
    #schema = {}

    // schema must be a JSON format describing field types in order, see README.md
    // token is optional and may be a 40 nibble hexidecimal string representing an existing token to pre-load into this object
    constructor(schema, token = null) {
        var rawschema = schema
        schema = JSON.parse(schema)

        // JSON isn't required according to RFC spec to maintain key position, however in our use-case key position is extremely important.
        // Therefore we will enforce it via manual key parsing. We'll also take this opportunity to clean up the provided schema, in sequence, for storage in the _schema member
        var key_position =  {}
        var key_regex = /^\s*"([^"]+)" *:/img;
        var match = key_regex.exec(rawschema);
        var position = 0
        var cleanschema = "{"
        while (match != null) {
            // matched text: match[0]
            // match start: match.index
            // capturing group n: match[n]
            key_position[match[1]] = position++
            cleanschema += '"' + match[1] + '":"' + schema[match[1]] + '"'
            match = key_regex.exec(rawschema);
            cleanschema += (match ? ',' : '')
        }
        cleanschema += "}"


        // now process the provided datatypes
        for (var key in schema) {
            var dtype = schema[key].toLowerCase()

            // parse the datatype entry
            var pieces = dtype.match(/((u)?(int|char)([0-9]+)_t|bit|bool)(?:\[([0-9]+)\])?/)

            assert(pieces, "data type should match specification, see README.md")

            // handle special case when bit or bool is specified, these are really uint1_t's
            if (pieces[1] == 'bit' || pieces[1] == 'bool') {
                pieces[2] = 'u'
                pieces[3] = 'int'
                pieces[4] = '1'
                pieces[5] = '1'
            }

            // the datatype is decomposed into four pieces of information used internally
            // note that all datatypes are considered to be arrays of length 1 or more
            var entry = { 
                signed: pieces[2] != 'u',
                ischar: pieces[3] == 'char',
                bitlen: pieces[4] != null ? parseInt(pieces[4]) : 1,
                arraylen: pieces[5] != null ? parseInt(pieces[5]) : 1
            }

            // check for invalid combinations
            assert(! (entry['signed'] && entry['ischar']), 'character types must be unsigned')
            assert(entry['bitlen'] > 0 && entry['bitlen'] <= 152, 'type bit length must be a positive integer less than 153')
            assert(entry['arraylen'] > 0 , 'type array length must be a positive integer')
            assert(! (entry['signed'] && entry['bitlen'] == 1), 'single bits cannot be signed')
            assert(!entry['ischar'] || (entry['bitlen'] >= 6 && entry['bitlen'] <= 8), "character type specified but unknown encoding, please use int instead for custom encoding. valid encodings are six-bit: uchar6_t, ascii: uchar7_t, utf-8: uchar8_t")

            // record the true position of the field according to the originally parsed schema
            entry['position'] = key_position[key]
            
            // execution to here means it's a valid datatype, add it assuming it's not somehow a duplicate key
            assert(!(key in this.#schema), "duplicate key " + key)
            this.#schema[key] = entry
        }

        // ensure mandatory fields have been included in the schema
        assert('type' in this.#schema && !this.#schema['type']['signed'] && !this.#schema['type']['ischar'] && this.#schema['type']['bitlen'] == 8 && this.#schema['type']['arraylen'] == 1, "mandatory uint8_t `type` field not specified")
        assert('subtype' in this.#schema && !this.#schema['subtype']['signed'] && !this.#schema['subtype']['ischar'] && this.#schema['subtype']['bitlen'] == 16 && this.#schema['type']['arraylen'] == 1, "mandatory uint16_t `subtype` field not specified")

        // check the bit count sums to less than 161
        var totalbits = 0
        for (var key in schema) 
            totalbits += this.#schema[key]['bitlen'] * this.#schema[key]['arraylen']
        assert(totalbits > 0 && totalbits <= 160, "total bit count of schema is too large, should be 160 bits or fewer, currently " + totalbits)

        // establish getters and setters for the object. the end developer is also free to use get(field) and set(field,value) if they wish
        for (var key in this.#schema)
            ((obj, key)=>{
                Object.defineProperty(this, key, {
                    enumerable: true,
                    get: ()=>{return obj.get(key)},
                    set: (newval)=>{return obj.set(key,newval)}
                })
            })(this, key)

        // set up a read only _schema member containing the cleaned up original schema provided by the developer
        Object.defineProperty(this, '_schema', {
            enumerable: true,
            value: cleanschema,
            writable: false
        })

        // set the initial state of the token to 0's
        this.reset()

        // if a hex token was provided during construction set it up now
        if (token)
            this.parse(token)
    }

    // returns the current value in the token object associated with a particular field, in decoded form.
    get(field) {
        // ensure the field exists
        assert(field in this.#schema, "field " + field + " not found in specified xls10 schema")

        var entry = this.#schema[field]
        var value = entry['value']

        // is it a string of some sort?
        if (entry['ischar']) {

            // only three string encodings are supported, this should never fire because it is enforced in constructor
            assert(entry['bitlen'] >= 6 && entry['bitlen'] <= 8, "three acceptable character encodings exist: six-bit, 7bit ascii, and utf-8")

            // check the internal representation of the string is correct
            assert(typeof(value) == 'bigint', 'internal representation of character array state for field ' + field + ' is corrupt, expecting bigint, found ' + typeof(value))

            // enc is the number of bits per character
            var enc = BigInt(entry['bitlen'])
            // len is the number of characters, all strings are fixed length records
            var len = BigInt(entry['arraylen'])

            // bitwise and mask for the size of one character
            var mask = (1n << enc) - 1n

            // arraylen tells us how many characters we are working with
            var s = ""
            var nextupper = false

            // todo: consider optimising this loop, probably only need one shift operation per loop
            for (var i = len - 1n; i >= 0n; --i) {
                var shift = i * enc
                var character = ( mask << shift ) & value
                character >>= shift

                if (enc == 6 && character == 0) {
                    nextupper = true
                    continue
                }

                var c = ( enc == 6 ? sixbit[parseInt(character)] : String.fromCharCode(parseInt(character)) )
                s += ( nextupper ? c.toUpperCase() : ( c!= '\x00' ? c : '' ))
                nextupper = false
            }

            return s
 
        } else {
            // datatype is integer
            if (entry['arraylen'] == 1) 
                return value[0]
            // datatype is an array
            return value
        }
    }

    // set the value of a field in the token object, in decoded form
    set(field, value, allowtruncation) {

        assert(field in this.#schema, "field `" + field + "` not found in specified xls10 schema")
        var entry = this.#schema[field]
        var enc = BigInt(entry['bitlen'])
        var len = entry['arraylen']

        if (entry['ischar']) {
            assert(entry['bitlen'] >= 6 && entry['bitlen'] <= 8, "three acceptable character encodings exist: six-bit, 7bit ascii, and utf-8")


            // arraylen tells us how many characters we are working with
            var encval = BigInt(0)
            
            assert(typeof(value) == "string", "when setting a character type you must provide a string")

            var count = 0;
            for (var i = len - 1; i >= 0; --i) {

                var c = (count < value.length ? value.charAt(count) : '\x00')
                var charval = ( c == '\x00' ? 0 : BigInt( enc == 6n ? sixbit.indexOf(c) : c.charCodeAt(0) ) )
           
                //console.log('charval: ' + charval)

                if (enc == 6n && c.match(/[A-Z]/)) {
                    // handle special capital letter edgecase
                    // insert a null character and then reiterate loop on lowercase version of character
                    encval <<= enc
                    value = replaceAt(value, count, c.toLowerCase())
                    continue
                }
 
                assert(!(enc == 6n && charval < 0n), "invalid character `" + c + "` for six-bit encoding, please see readme.md section 4.1 for valid characters")
                assert(!(enc == 7n && (charval < 0n || charval > 127n)), "invalid character `" + c + "` for 7 bit ASCII encoding, please refer to 0-127 ASCII table")

                encval <<= enc
                encval += BigInt(charval)

                count++
            }
              

            // check if we had more string left to encode when we finished
            if (!allowtruncation)
                assert(count >= value.length, "Attempted to set a string of length " + value.length + " into a field of length " + entry['arraylen'] + ( entry['bitlen'] == 6 ? '. If this error makes no sense you may need to account for capitals taking two characters in this encoding' : '') )

//            console.log("encoded value: " + encval)
            this.#schema[field]['value'] = encval
 
        } else {
            // datatype is integer
            var field_signed = entry['signed']

            if (typeof(value) != 'object') value = [value]


            if (entry['bitlen'] == 1)
                for (var x in value)
                    if (typeof(value[x]) == 'boolean') value[x] = ( value[x] ? 1n : 0n ) 

            assert(typeof(value) == 'object' && 'length' in value && value.length == len, "must provide a value or array of values of the correct length corresponding to the datatype")


            //console.log("signed: " + field_signed + ", enc: " + enc)
            // first establish the largest int that will fit in the type
            var largest = (1n << ( field_signed ? enc - 1n : enc )) - 1n
            var smallest = (field_signed ? -largest - 1n : 0n )
            //console.log("largest: " + largest)

            var copy = []

            for (var i = 0; i < value.length; ++i) {
                assert(typeof(value[i]) == 'number' || typeof(value[i]) == 'bigint', "you may only provide integer values to integer types")
                var v = BigInt(value[i])
                assert(v >= smallest && v <= largest, "value '" + v + "' is outside allowable range of '" + smallest + "' to '" + largest + "' for field `" + field + "`")
                copy.push(v)
            }

            // then do the assignment
            this.#schema[field]['value'] = copy
 
        }
        
    }

    // reset all values in the object, preserving the (immutable) schema
    reset() {
        for (var field in this.#schema) {
            if (field == '_schema') continue
            var entry = this.#schema[field]
            this.#schema[field]['value'] = ( entry['ischar'] ? 0n : Array(entry['arraylen']).fill(0n) )
        }
    }


    // parse a token from hexadecimal to usable object
    parse(token) {
        
        // enforce hex encoding
        assert(typeof(token) == 'string' && token.length == 40 && token.match(/^[a-fA-F0-9]{40}$/), "must provide a 40 nibble hexidecimal string representing the token")

        // clear out anything currently residing in the object's value fields
        this.reset()

        // convert to big int to get started -- this is big endian, so is bigint.toString(16) so we don't need to worry about endianness in encoding/decoding to bigint
        token = BigInt('0x' + token) 

        // ensure we have the canonical field order
        var keys = {}
        var schemabitlen = 0n
        for (var field in this.#schema) {
            keys[this.#schema[field]['position']] = field
            schemabitlen += BigInt(this.#schema[field]['bitlen'] * this.#schema[field]['arraylen'])
        }

        assert(Object.keys(keys).length == Object.keys(this.#schema).length, "schema has duplicate position entry")

        // remove right hand padding (this is when a token's schema is smaller than 160 bits, it has right padded 0's)
        token >>= (160n - schemabitlen)

        // parse right to left, shifting as we go
        for (var fieldid = Object.keys(keys).length-1; fieldid >= 0; --fieldid) {

            // pull out values to make code easier to read below
            var field = keys[fieldid]
            var entry = this.#schema[field]
            var enc = BigInt(entry['bitlen'])
            var len = BigInt(entry['arraylen'])
            var value = entry['value']
            var signed = entry['signed']

            if (entry['ischar']) {
                // simply import the bits directly without modification
                var bitmask = (1n << (enc * len)) - 1n
                this.#schema[field]['value'] = token & bitmask
                token >>= (enc * len)
            } else {
                // it's a number or array of numbers
                
                // this is the bit-mask for a single entry in the array
                var bitmask = (1n << enc) - 1n
                
                // this is the bit-mask for the most significant bit aka sign bit, we can use this to determine if it's a negative
                var msbmask = (1n << (enc - 1n))

                for (var n = 0; n < len; ++n) {
                    // mask off the current integer
                    var value = token & bitmask

                    // handle 2's complement if the type is signed and we have a sign bit
                    if (signed && (token & msbmask)) {
                        value -= msbmask
                        value++
                        value *= -1n
                    }
                    
                    // set the decoded value in the object's representation
                    this.#schema[field]['value'][n] = value

                    // shift to the next integer
                    token >>= enc
                }
            }
        }
    }



    // convert object's internal representation into a 40 nibble hexadecimal token representation according to the schema    
    tokenize() {
       
        // the schema keys should already be in the correct order but we're going to double check that
        var keys = {}
        var schemabitlen = 0n
        for (var field in this.#schema) {
            keys[this.#schema[field]['position']] = field
            schemabitlen += BigInt(this.#schema[field]['bitlen'] * this.#schema[field]['arraylen'])
        }

        assert(Object.keys(keys).length == Object.keys(this.#schema).length, "schema has duplicate position entry")

        // since the largest token is 160 bits and 2^160-1 will easily fit inside a bigint, we will use bigint until the very end
        var output = 0n

        var fieldcount = Object.keys(keys).length
        for (var fieldid = 0; fieldid < fieldcount; ++fieldid) {
            var field = keys[fieldid]
            var entry = this.#schema[field]

            // pull these values out for readability of code below
            var enc = BigInt(entry['bitlen'])
            var len = BigInt(entry['arraylen'])
            var value = entry['value']
            var signed = entry['signed']

            // is it a string type?
            if (entry['ischar']) {
                // string types are encoded and decoded in the setter and getter, so they are ready to be put into the token from raw internal state
                assert(typeof(value) == 'bigint', "attempted to tokenize character type that isn't stored as a bigint")
                output <<= (enc * len)
                output += value
            } else {
                // integer types (including integer arrays) are stored as signed bigints internally, so should be converted to match encoding here

                // all int types are internally recorded as an array of bigints of length 1 or greater
                assert(typeof(value) == 'object' && 'length' in value, "attempted to tokenize integer type that isn't stored as an array of numbers")

                // process the array of ints
                for (var n = value.length - 1; n >= 0; --n) {
                    var v = value[n]
                    assert(typeof(v) == 'bigint', "attempted to tokenize non-number as integer type")
                    assert( signed  || v >= 0n, "attempted to tokenize a negative value into an unsigned field")

                    // apply two's complement where required
                    if (signed && v < 0n) { //todo: fix 2's complement
                        v = (v*-1n) - 1n 
                        v += (1n << (enc - 1n))
                    }

                    // make space in the output token for the int then add it
                    output <<= enc
                    output += v
                }

            }
            
        } 

        // right pad with 0's to make up any missing bits from 160 bit total
        output <<= (160n - schemabitlen)

        // convert to hex
        var outhex = output.toString(16)
        assert(outhex.length <= 40, "output hex too long (" + outhex.length + " nibbles), schema must be corrupted")

        // left pad any missing 0's from the hex (should only ever be at most 1, due to right padding above)
        outhex = "0".repeat(40 - outhex.length) + outhex

        return outhex
    }

    // a human readable current value representation of the token, designed for printing, not reconstruction
    toString() {
        var keys = {}
        for (var field in this.#schema)
            keys[this.#schema[field]['position']] = field

        assert(Object.keys(keys).length == Object.keys(this.#schema).length, "schema has duplicate position entry")
    
        var retval = "{\n\t"

        var fieldcount = Object.keys(keys).length

        for (var n = 0; n < fieldcount; ++n) {
            var entry = this.#schema[keys[n]]
            retval += '"' + keys[n] + '": '
            if (entry['ischar']) {
                retval += '"' + entry['value'] + '"'
            } else if (entry['arraylen'] == 1) {
                retval += entry['value'][0]
            } else {
                retval += '['
                for (var x = 0; x < entry['value'].length; ++x)
                    retval += entry['value'][x] + (x != entry['value'].length-1 ? ', ' : '')
                retval += ']'
            }
            retval += (n != fieldcount-1 ? ",\n\t" : "\n")
        }
        retval += "}\n"
        return retval 
    }

}

module.exports = XLS10Token


