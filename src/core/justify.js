
function mkmat(w, h) {
    let a = new Array(w);
    for (let i = 0; i < w; ++i) {
        a[i] = new Array(h).fill(0);
    }
    return a;
}

function matstr(m) {
    let str = "";
    for (let i = 0; i < m.length; ++i) {
        for (let j = 0; j < m[i].length; ++j) {
            if (m[i][j] == Infinity) {
                str += "  ∞ ";
            } else {
                str += String(m[i][j]).padStart(3, ' ') + " ";
            }
        }
        str += "\n";
    }
    return str;
}

// Use something like `document.getElementById("myObject").width`
// to get the width in pixels in case of html
function wordWidth(str) {
    str = str.replace(/[^\u0621-\u064A0-9{} ]/g, "")
        .replace(/ﭐ/g, "ا");
    return str.length;
}

export function justify(text, width, simple=false, arabic=false) {
    // Based on https://github.com/mission-peace/interview/blob/master/src/com/interview/dynamic/TextJustification.java
    // https://youtu.be/RORuwHiblPc

    text = text.trim();

    if (text.length < width) return text;

    let words = text.split(" ");
    let cost = mkmat(words.length, words.length);

    // next 2 for loop is used to calculate cost of putting words from
    // i to j in one line. If words don't fit in one line then we put
    // Infinity

    for (let i = 0; i < words.length; ++i) {
        cost[i][i] = width - wordWidth(words[i]);
        for (let j = i + 1; j < words.length; ++j) {
            cost[i][j] = cost[i][j - 1] - wordWidth(words[j]) - 1;
        }
    }

    for (let i = 0; i < words.length; ++i) {
        for (let j = i; j < words.length; ++j){
            if (cost[i][j] < 0) {
                cost[i][j] = Infinity;
            } else {
                cost[i][j] = Math.pow(cost[i][j], 2) | 0;
            }
        }
    }

    // minCost from i to len is found by trying
    // j between i to len and checking which
    // one has min value

    let minCost = new Array(words.length);
    let result  = new Array(words.length);
    for (let i = words.length - 1; i >= 0; --i) {
        minCost[i] = cost[i][words.length - 1];
        result[i] = words.length;
        for (let j = words.length - 1; j > i; --j) {
            if (cost[i][j-1] == Infinity) {
                continue;
            }
            if (minCost[i] > minCost[j] + cost[i][j - 1]) {
                minCost[i] = minCost[j] + cost[i][j - 1];
                result[i] = j;
            }
        }
    }

    // finally put all words with new line added in string

    let i = 0;
    let j, k;
    let res = "";
    do {
        j = result[i];
        let line = [];
        let wordsLen = 0;
        for (k = i; k < j; ++k) {
            line.push(words[k]);
            wordsLen += wordWidth(words[k]);
        }

        if (simple) {
            
            res += line.join(" ") + "\n";
            
        } else if (arabic) {
            
            // Not after: ا د ذ ر ز و ء
            // Not before: ء
            const allowed = "جحخهعغفقثصضطكمنتبيسشظئـ";
            const tatweel = "ـ";
            const isAllowed = s => {
                for (let c of allowed)
                    if (s.includes(c)) return true;
                return false;
            };
            line = line.join(" ");
            let extension = width - line.length;
            // Those are reshaped in arabic to one character
            const howManyTimes = (s, t) => s.split(t).length - 1;
            extension += howManyTimes(line, "لا");
            extension += howManyTimes(line, "لأ");
            extension += howManyTimes(line, "لإ");
            extension += howManyTimes(line, "لآ");
            // extend after every `n` characters
            let n = line.length / (extension + 1);
            let pos, curPos;
            for (let c = 1; c <= extension; ++c) {
                pos = n * c;
                curPos = pos;
                // TODO: what if this goes infinite?
                while (!isAllowed(line.charAt(curPos)) ||
                       curPos >= line.length - 1 ||
                       (curPos + 1 < line.length &&
                        line.charAt(curPos + 1) == ' ')) {
                    curPos = (curPos + 1) % line.length;
                }
                line = line.substring(0, curPos + 1) + tatweel + line.substring(curPos + 1);
            }
            res += line + "\n";
            
        } else { // Spread spaces between words
            
            let spaces = (width - wordsLen) / (line.length - 1) | 0;
            let spacesStr = " ".repeat(spaces);
            for (k = 0; k < line.length - 1; ++k) {
                res += line[k] + spacesStr;
            }
            // If odd, add the extra space to the end
            if ((width - wordsLen) % (line.length - 1) != 0) {
                res += " ";
            }
            res += line[k] + "\n";
            
        }

        i = j;
    } while(j < words.length);

    return res;
}
