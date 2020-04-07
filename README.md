# XLS-10 - NodeJS Library
## 1. Introduction
The XLS-10 standard allows for storage of arbitrary data non-fungible tokens on the XRPL. However manipulation of these tokens and efficient use of the data encoded in them is restricted to programmers proficient in bit-packing. To alleviate this the library before you provides for some quality of life routines for creating, reading and updating XLS-10 tokens.

## 2. Minimum Token Specification
Taken directly from XLS-10 specification the minimum constitution of a 160 bit XLS-10 token is as follows:
```[ Type = 0xFF ] [ Sub type = 0x0000-0xFFFF ] [ Payload = 136b ]```
`Byte 0` – Type code: must be 0xFF meaning Issuer Controlled Token
`Byte 1-2` — Subtype code: Unsigned big endian 16 bit integer. Allocated according to a standards database such as this one. This number 0-65,535 tells wallets how to interpret this token.
`Byte 3-19` – Payload bytes: 136 bits of arbitrary data the token encodes.

## 3. Schema Language
This language tells the library how to treat the bits in an XLS-10 token. It uses a familiar `JSON` structure and familiar `stdint` datatypes.
The schema language has the following constraints:
1. The schema must be valid JSON
2. The entries must be of the form `"field_name": "stdint-data-type"`
3. The first entry must be named `type` and have data-type `uint8_t`, for XLS-10 tokens this value will always be `0xFF`
4. The second entry must be named `subtype` and have data-type `uint16_t`, this will be the allocated XLS-10 token-type
5. Entries may use arrays but only of fixed lengths of the form `"field_name": "stdint-data-type[N]"` where N is a positive integer
6. All data-types are implicitly in network-byte order (big endian)
7. The total sum of data-type sizes must to less than or equal to 152 bits
8. A six-bit-per-character encoding scheme for a reduced ASCII is defined as `uchar6_t` [see part 4]
9. An integer type may be constructed in any bit size, e.g. `uint2_t` for a 2 bit unsigned int.
10. A single bit may be specified using  `bool` or `uint1_t`

 Examples follow:
 ```
URL token example
{
	"type": "uint8_t",    //must be 0xFF -- XLS-10 token type
	"subtype": "uint16_t",//0xFFFD -- URL pointer type
	"urltype": "uint4_t", //0x0 -- HTTPS Informational pointer
	"URL": "uchar6_t[22]" // up to 22 6-bit characters of URL excluding protocol
}
```

```
Persistent game state example
{
	"type": "uint8_t",          //must be 0xFF -- XLS-10 token type
	"subtype": "uint16_t",      //0x???? -- needs to be assigned an XLS-10 subtype
	"gametype": "uint16_t",     // a game type specifier
	"gamestate": "uint8_t[15]"  // 15 bytes of arbitrary game state, e.g wins/losses, character traits etc.
}
 ```

```
Identity example 
{
	"type": "uint8_t",          //must be 0xFF -- XLS-10 token type
	"subtype": "uint16_t",      //0x???? -- needs to be assigned an XLS-10 subtype
	"over_18": "bit",
	"over_21": "bit",
	"license_expiry": "uint12_t", // driver's license expiry number of months since jan 2020, or 0x000 for no license
	"passport_expiry": "uint12_t", // as above
	"unique_person_id": "uint110_t" // 110 bit short input hash of name, dob, place of birth and birth certificate number
}
```

## 4. Character strings
Strings are represented as fixed length arrays of characters. The chosen character datatype is very important to efficiently use token space.

If uppercase is required then `uchar7_t` should be used instead which should be interpreted as `7 bit ASCII`. If `utf-8` is required then `uchar8_t` should be used.

To conserve bits where possible `uchar6_t` should be used. This is a novel character set that lacks explicit uppercase and contains some compression for common top level domains, so it may not be suitable for all uses. It is designed for use with URLs. Character 0 may be used to mark that next character as uppercase, it may also be used at the end of a string to fill remaining characters marking those as null.

### 4.1 uchar6_t character table
Reference table:
|0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31|32|33|34|35|36|37|38|39|40|41|42|43|44|45|46|47|48|49|50|51|52|53|54|55|56|57|58|59|60|61|62|63|
|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|
|`<null/upper>`|a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z|0|1|2|3|4|5|6|7|8|9|.|-|_|:|/|?|#|[|]|@|!|$|&|(|)|*|'|+|,|;|=|~|%|.com|.net|.org|.io|

Array for importing into C-like languages:
```C++
[
  '\0', 'a',    'b',    'c',   'd', 'e',
  'f',      'g',    'h',    'i',   'j', 'k',
  'l',      'm',    'n',    'o',   'p', 'q',
  'r',      's',    't',    'u',   'v', 'w',
  'x',      'y',    'z',    '0',   '1', '2',
  '3',      '4',    '5',    '6',   '7', '8',
  '9',      '.',    '-',    '_',   ':', '/',
  '?',      '#',    '[',    ']',   '@', '!',
  '$',      '&',    '(',    ')',   '*', "'",
  '+',      ',',    ';',    '=',   '~', '%',
  '.com',   '.net', '.org', '.io'
]
```

## 5. Usage
`to be continued`
