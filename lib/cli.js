#!/usr/bin/env node

/* eslint-disable no-sync, no-process-exit */
'use strict';
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const _isString = require('lodash/isString');
const _range = require('lodash/range');
const chalk = require('chalk');
const figures = require('figures');
const frontMatter = require('front-matter');
const meow = require('meow');
const stdin = require('get-stdin');
const updateNotifier = require('update-notifier');

const medic = require('../');
const pkg = require('../package.json');

const NOT_FOUND = 200;
const INTERNAL_ERROR = 500;
const HELP_FILE_PATH = path.join(__dirname, 'help.txt');


updateNotifier({ pkg }).notify();

const cli = meow({
    pkg,
    help: fs.readFileSync(HELP_FILE_PATH, { encoding: 'utf8' }).trim(),
    flags: {
        compare: {
            alias: 'p',
            type: 'string'
        },
        concurrency: {
            alias: 'c',
            type: 'string',
            default: 5
        },
        output: {
            alias: 'o',
            type: 'string',
        },
        rate: {
            alias: 'r',
            type: 'string',
            default: 2
        },
        interval: {
            alias: 'i',
            type: 'string',
            default: 1
        },
        help: {
            alias: 'h'
        },
        version: {
            alias: 'v'
        }
    }
});

// Always set a concurrency to avoid DOSing sites on Node >=0.12
http.globalAgent.maxSockets = cli.flags.concurrency;
https.globalAgent.maxSockets = cli.flags.concurrency;


/**
 * Add the terminal status color for the given result to a string.
 * @param {number}  result
 * @param {string}  message
 * @return {string}
 */
function addStatusColor(result, message) {
    let coloredMessage = message;

    if (result.statusCode === NOT_FOUND) {
        coloredMessage = chalk.green(message);
    } else if (result.error || result.statusCode === INTERNAL_ERROR) {
        coloredMessage = chalk.red(message);
    } else {
        coloredMessage = chalk.yellow(message);
    }

    return coloredMessage;
}


stdin().then((stdinUrls) => {
    let progress = 1;
    let urlsFilePath;
    let urlsString;
    let previousResults;
    let outputFilePath;


    // Require stdin or a urls file
    if (!stdinUrls && !_isString(cli.input[0])) {
        cli.showHelp();
        process.exit(1);
    }

    // Try reading urls file if no stdin
    if (stdinUrls) {
        urlsString = stdinUrls;
    } else {
        urlsFilePath = path.resolve(cli.input[0]);
        if (!fs.existsSync(urlsFilePath) || !fs.statSync(urlsFilePath).isFile()) {
            console.error('File doesn\'t exist:', urlsFilePath);
            process.exit(1);
        }

        urlsString = fs.readFileSync(urlsFilePath, { encoding: 'utf8' });
    }

    const frontMatterData = frontMatter(urlsString);


    // Parse urls from string
    const urls = frontMatterData.body.match(/^https?:\/\/(.*?)$/mg) || [];
    const urlsNumLength = String(urls.length).length;


    if (_isString(cli.flags.compare)) {
        // Check compare file exists
        const compareFilePath = path.resolve(cli.flags.compare);
        if (!fs.existsSync(compareFilePath) || !fs.statSync(compareFilePath).isFile()) {
            console.error('File doesn\'t exist:', compareFilePath);
            process.exit(1);
        }

        // Parse results from file
        const compareFileContent = fs.readFileSync(compareFilePath, { encoding: 'utf8' });
        previousResults = JSON.parse(compareFileContent);
    }


    if (_isString(cli.flags.output)) {
        outputFilePath = path.resolve(cli.flags.output);
    }


    /**
     * Logs the check progress to the terminal.
     * @param {object} result
     */
    function progressLog(result) {
        let icon;
        const progressNumLength = String(progress).length;
        const padding = _range(0, urlsNumLength - progressNumLength, 0).join('');

        if (result.statusCode === NOT_FOUND) {
            icon = figures.tick;
        } else if (result.error || result.statusCode === INTERNAL_ERROR) {
            icon = figures.cross;
        } else {
            icon = figures.warning;
        }

        console.log(addStatusColor(result, `${padding}${progress}/${urls.length}  ${icon}  ${(result.error ? 'err' : result.statusCode)}  ${result.url}`));
        progress += 1;
    }

    return medic.check({
        cookies: frontMatterData.attributes.cookies,
        urls,
        onProgress: progressLog,
        rate: cli.flags.rate,
        interval: cli.flags.interval
    }).then((results) => {
        // process results
        let compareResults = [];

        // Do compare if compare file was given
        if (previousResults) {
            compareResults = medic.compare({
                currentResults: results,
                previousResults
            });
        }

        // Ouput changes if there were any
        if (compareResults.length > 0) {
            console.log();
            console.log(chalk.bold('Changes'));
            console.log();

            compareResults.forEach((result) => {
                // logCompareResult
                const previousStatusCode = result.previous.error ? 'err' : result.previous.statusCode;
                const currentStatusCode = result.current.error ? 'err' : result.current.statusCode;

                console.log(
                    addStatusColor(result.previous, previousStatusCode),
                    figures.arrowRight,
                    '',
                    addStatusColor(result.current, currentStatusCode),
                    '',
                    result.previous.url
                );
            });
        }

        // Output results if output path was given
        if (outputFilePath) {
            const resultsString = JSON.stringify(results, null, 2);
            fs.writeFileSync(outputFilePath, resultsString);
        }
    });
}).catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
});
