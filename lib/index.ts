import * as github from "./github";
import * as npm from "npm";
import * as header from "definition-header";

export interface ReviewResult {
    parent: github.PRInfo;
    file: github.PullRequestFile;
    baseHeader?: header.Result;
    authorAccounts: string[];
    unknownAuthors: header.model.Author[];
    message?: string;
}

function processAdded(reviewResult: ReviewResult): Promise<ReviewResult> {
    "use strict";

    let comment = "";
    function log(text: string) {
        comment += text + "\n";
    }

    let info = reviewResult.parent;
    let file = reviewResult.file;

    let packageName = file.filename.substr(0, file.filename.indexOf("/"));
    let testFileNames = [file.filename.substr(0, file.filename.length - 5) + "-tests.ts"];
    testFileNames[1] = testFileNames[0] + "x";
    let testFileExists = info.files.filter(f => testFileNames.indexOf(f.filename) !== -1).length !== 0;

    let content = info.contents[file.filename];
    let headerInfo = header.parse(content);
    if (headerInfo.success) {
        reviewResult.baseHeader = headerInfo;
    }

    return new Promise<ReviewResult>((resolve, reject) => {
        npm.load(null, err => {
            (npm.commands.info as any)([packageName], true, (err: any, result: any) => {
                let npmExists = false;
                let info: any;
                if (!err && reviewResult.baseHeader) {
                    info = result[Object.keys(result)[0]] || {};
                    if (info.homepage === reviewResult.baseHeader.value.project[0].url) {
                        npmExists = true;
                    }
                }

                log(`Checklist`);
                log(``);
                log(`* [${npmExists ? "X" : " "}] is correct [naming convention](http://definitelytyped.org/guides/contributing.html#naming-the-file)?`);
                if (npmExists) {
                    log(`  * https://www.npmjs.com/package/${packageName} - ${info.homepage}`);
                } else {
                    log(`  * https://www.npmjs.com/package/${packageName}`);
                    log(`  * http://bower.io/search/?q=${packageName}`);
                    log(`  * others?`);
                }
                log(`* [${testFileExists ? "X" : " "}] has a [test file](http://definitelytyped.org/guides/contributing.html#tests)? (${testFileNames.join(" or ")})`);
                log(`* [ ] pass the Travis CI test?`);

                reviewResult.message = comment;

                resolve(reviewResult);
            });
        });
    });
}

function convertAuthorToAccount(author: header.model.Author): string[] {
    "use strict";

    switch (author.url) {
        case "https://asana.com":
            return ["@pspeter3", "@vsiao"];
        case "http://phyzkit.net/":
            return ["@kontan"];
        case "http://ianobermiller.com":
            return ["@ianobermiller"];
        default:
            return null;
    }
    return null;
}

function processModified(reviewResult: ReviewResult): Promise<ReviewResult> {
    "use strict";

    let comment = "";
    function log(text: string) {
        comment += text + "\n";
    }

    let info = reviewResult.parent;
    let file = reviewResult.file;

    let content = info.baseContents[file.filename];
    let headerInfo = header.parse(content);
    if (!headerInfo.success) {
        reviewResult.message = "can't parse definition header...";
        return Promise.resolve(reviewResult);
    }
    reviewResult.baseHeader = headerInfo;
    headerInfo.value.authors.forEach(author => {
        let accountNames = convertAuthorToAccount(author);
        if (accountNames) {
            reviewResult.authorAccounts = reviewResult.authorAccounts.concat(accountNames);
            return;
        }

        let regexp = /https?:\/\/github.com\/(.*)\/?/;
        let reArray: string[] = regexp.exec(author.url) || [];
        let accountName = reArray[1];
        if (accountName) {
            reviewResult.authorAccounts.push(`@${accountName}`);
        } else {
            reviewResult.unknownAuthors.push(author);
        }
    });

    let accountNames: string[] = [].concat(reviewResult.authorAccounts);

    reviewResult.unknownAuthors.forEach(author => {
        accountNames.push(`${author.name} (account can't be detected)`);
    });

    if (accountNames.length !== 0) {
        log(`to author${accountNames.length === 1 ? "" : "s"} (${accountNames.join(" ")}). Could you review this PR?`);
        log(":+1: or :-1:?");
    }

    log(``);
    log(`Checklist`);
    log(``);
    log(`* [ ] pass the Travis CI test?`);

    reviewResult.message = comment;

    return Promise.resolve(reviewResult);
}

export function generateComment(pr: github.PRInfoRequest): Promise<string[]> {
    "use strict";

    return constructReviewResult(pr)
        .then(ts => ts.map(result => [`*${result.file.filename}*`, "", result.message].join("\n")));
}

export function constructReviewResult(pr: github.PRInfoRequest): Promise<ReviewResult[]> {
    "use strict";

    return github
        .getPRInfo(pr)
        .then(info => {
            let ps = info.files
                .filter(file => /\.d\.ts(x)?$/.test(file.filename))
                .map((file, idx, files) => {
                    let reviewResult: ReviewResult = {
                        parent: info,
                        file: file,
                        authorAccounts: [],
                        unknownAuthors: [],
                    };

                    if (file.status === "modified") {
                        return processModified(reviewResult);
                    } else if (file.status === "added") {
                        return processAdded(reviewResult);
                    }

                    reviewResult.message = `unknown status: ${file.status}`;

                    return Promise.resolve(reviewResult);
                });
            return Promise.all(ps);
        });
}
