let regular_string = "str\n\"";
let empty_string = "";

let cool_string = "cool \"\${${regular_string}}\" test";
let really_cool_string = "${empty_string}\n${cool_string}\n\${empty_string}${"string-in-string"}!";