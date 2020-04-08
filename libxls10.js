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
  '=',    '~',    '%',   '.com',
  '.net', '.org', '.io'
]

function replaceAt(s, index, char) {
    return s.substr(0,index) + char + s.substr(index+1)
}

class XLS10Token {
    #schema = {}
    constructor(schema, token = null) {
        schema = JSON.parse(schema)
        var count = 0
        for (var key in schema) {
            var dtype = schema[key]
            // technically they shouldn't be allowed to mix case but we're all about compatibility
            dtype = dtype.toLowerCase()
            // preflight check
            var pieces = dtype.match(/((u)?(int|char)([0-9]+)_t|bit|bool)(?:\[([0-9]+)\])?/)

            assert(pieces, "data type should match specification, see readme.md")

            if (pieces[1] == 'bit' || pieces[1] == 'bool') {
                pieces[2] = 'u'
                pieces[3] = 'int'
                pieces[4] = '1'
                pieces[5] = '1'
            }

            var entry = { 
                signed: pieces[2] != 'u',
                ischar: pieces[3] == 'char',
                bitlen: pieces[4] != null ? parseInt(pieces[4]) : 1,
                arraylen: pieces[5] != null ? parseInt(pieces[5]) : 1
            }

            // prefill with valid value state ( 0's )
            entry['value'] = ( entry['ischar'] ? 0n : Array(entry['arraylen']).fill(0n) )


            // filter out cowboy operators
            assert(! (entry['signed'] && entry['ischar']), 'character types must be unsigned')
            assert(entry['bitlen'] > 0 && entry['bitlen'] <= 152, 'type bit length must be a positive integer less than 153')
            assert(entry['arraylen'] > 0 , 'type array length must be a positive integer')
            assert(! (entry['signed'] && entry['bitlen'] == 1), 'single bits cannot be signed')

            assert(!entry['ischar'] || (entry['bitlen'] >= 6 && entry['bitlen'] <= 8), "character type specified but unknown encoding, please use int instead for custom encoding. valid encodings are six-bit: uchar6_t, ascii: uchar7_t, utf-8: uchar8_t")

            entry['position'] = count++
            
            // execution to here means it's probably valid datatype, add it
            assert(!(key in this.#schema), "duplicate key " + key)
            this.#schema[key] = entry
        }

    
        assert('type' in this.#schema && !this.#schema['type']['signed'] && !this.#schema['type']['ischar'] && this.#schema['type']['bitlen'] == 8 && this.#schema['type']['arraylen'] == 1, "mandatory uint8_t `type` field not specified")
        assert('subtype' in this.#schema && !this.#schema['subtype']['signed'] && !this.#schema['subtype']['ischar'] && this.#schema['subtype']['bitlen'] == 16 && this.#schema['type']['arraylen'] == 1, "mandatory uint16_t `subtype` field not specified")


        // check the bit count sums to less than 161
        var totalbits = 0
        for (var key in schema) 
            totalbits += this.#schema[key]['bitlen'] * this.#schema[key]['arraylen']
        
        entry['value'] = 0

        assert(totalbits > 0 && totalbits <= 160, "total bit count of schema is too large, should be 160 bits or fewer, currently " + totalbits)

        if (token)
            this.parse(token)
    }

    get(field) {
        assert(field in this.#schema, "field " + field + " not found in specified xls10 schema")
        var entry = this.#schema[field]
        // conversion to js datatype required

        var value = entry['value']

        // is it a char?
        if (entry['ischar']) {
            assert(entry['bitlen'] >= 6 && entry['bitlen'] <= 8, "three acceptable character encodings exist: six-bit, 7bit ascii, and utf-8")

            var enc = entry['bitlen']
            var len = entry['arraylen']

            // bitmask
            var mask = BigInt((1 << enc) - 1)

            // arraylen tells us how many characters we are working with
            var s = ""
            var nextupper = false

            for (var i = len - 1; i >= 0; --i) {
                var shift = BigInt(i * enc)
                var character = ( mask << shift ) & value
                character >>= shift

                if (enc == 6 && character == 0) {
                    nextupper = true
                    continue
                }


                var c = ( enc == 6 ? sixbit[parseInt(character)] : String.fromCharCode(parseInt(character)) )
                s += ( nextupper ? c.toUpperCase() : c )
                nextupper = false
            }

            return s
 
        } else {
            // datatype is integer

            return value
        }
    }

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

            console.log("encoded value: " + encval)
            this.#schema[field]['value'] = encval
 
        } else {
            // datatype is integer
            var field_signed = entry['signed']
            if (typeof(value) == 'number' || typeof(value) == 'bigint') value = [value]

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
            var entry = this.#schema[field]
            this.#schema[field]['value'] = ( entry['ischar'] ? 0n : Array(entry['arraylen']).fill(0n) )
        }
    }


    parse(token) {
        
        assert(typeof(token) == 'string' && token.length == 40 && token.match(/^[a-fA-F0-9]{40}$/), "must provide a 40 nibble hexidecimal string representing the token")

        // clear out anything currently residing in the object's value fields
        this.reset()

        // convert to big int to get started 
        token = BigInt('0x' + token) 

        // ensure we have the canonical field order
        var keys = {}
        var schemabitlen = 0n
        for (var field in this.#schema) {
            keys[this.#schema[field]['position']] = field
            schemabitlen += BigInt(this.#schema[field]['bitlen'] * this.#schema[field]['arraylen'])
        }

        assert(Object.keys(keys).length == Object.keys(this.#schema).length, "schema has duplicate position entry")

        // remove right hand padding
        token >>= (160n - schemabitlen)

        // parse right to left, shifting as we go
        for (var fieldid = Object.keys(keys).length-1; fieldid >= 0; --fieldid) {
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

                var bitmask = (1n << enc) - 1n

                var msbmask = (1n << (enc - 1n))

                for (var n = 0; n < len; ++n) {
                    var value = token & bitmask

                    // handle 2's complement
                    if (signed && (token & msbmask)) {
                        value -= msbmask
                        value++
                        value *= -1n
                    }
                    
                    this.#schema[field]['value'][n] = value

                    token >>= enc
                }
            }
        }
    }


    tokenize() {
       
        // the schema keys should already be in the correct order but we're going to double check that
        var keys = {}
        var schemabitlen = 0n
        for (var field in this.#schema) {
            keys[this.#schema[field]['position']] = field
            schemabitlen += BigInt(this.#schema[field]['bitlen'] * this.#schema[field]['arraylen'])
        }

        assert(Object.keys(keys).length == Object.keys(this.#schema).length, "schema has duplicate position entry")

        var output = 0n

        var fieldcount = Object.keys(keys).length
        for (var fieldid = 0; fieldid < fieldcount; ++fieldid) {
            var field = keys[fieldid]
            var entry = this.#schema[field]

            var enc = BigInt(entry['bitlen'])
            var len = BigInt(entry['arraylen'])
            var value = entry['value']
            var signed = entry['signed']

            if (entry['ischar']) {
                assert(typeof(value) == 'bigint', "attempted to tokenize character type that isn't stored as a bigint")
                output <<= (enc * len)
                output += BigInt(value)
            } else {
                assert(typeof(value) == 'object' && 'length' in value, "attempted to tokenize integer type that isn't stored as an array of numbers")

                for (var n = value.length - 1; n >= 0; --n) {
                    var v = value[n]
                    assert(typeof(v) == 'bigint', "attempted to tokenize non-number as integer type")
                    assert( signed  || v >= 0n, "attempted to tokenize a negative value into an unsigned field")

                    // apply two's complement where required
                    if (signed && v < 0n) { //todo: fix 2's complement
                        v = (v*-1n) - 1n 
                        v += (1n << (enc - 1n))
                    }

//                    console.log("outputing: " + value[n] + " as " + v + " | 0x" + v.toString(16) + " | " + v.toString(2) )

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
        outhex = "0".repeat(40 - outhex.length) + outhex

        return outhex

    }

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


