'use strict';
const _ = require('lodash');
const request = require('request-promise-native');
const RequestLimiter = require('request-rate-limiter');


/**
 * Checks the status of all the passed URLs.
 * @param  {object}   opt
 * @return {Promise}
 */
function check(opt, callback) {
    const options = _.defaults(opt, {
        urls: [],
        cookies: [],
        onProgress: _.noop,
        rate: 0,
        interval: 0,
        maxWaitingTime: 0
    });
    const waitTolerance = 1.3;
    const rateLimiter = new RequestLimiter({
        rate: options.rate,
        interval: options.interval,
        maxWaitingTime: waitTolerance * options.urls.length * options.interval / options.rate
    });

    const urlRequests = options.urls.map((requestUrl) => {
        const jar = request.jar();

        options.cookies.forEach((cookie) => {
            jar.setCookie(request.cookie(cookie), requestUrl);
        });

        return rateLimiter.request()
            .then(() => {
                return request.get({
                    resolveWithFullResponse: true,
                    simple: false,
                    url: requestUrl,
                    jar, // Store cookies (separate for each url)
                    gzip: true,
                    headers: { // Pretend to be Chrome for any bad user agent sniffers
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_3) AppleWebKit/537.31 (KHTML, like Gecko) Chrome/26.0.1410.65 Safari/537.31'
                    }
                });
            })
            .then((response) => {
                const responseUrl = response.request.uri.href;
                const result = {
                    url: requestUrl,
                    statusCode: response.statusCode,
                    body: response.body
                };

                // Hack for incorrent status code on ASP.NET 500 error page and
                // misc ASP.NET server-side errors that bypass the 500 error page
                if (responseUrl.indexOf('500.aspx') >= 0 ||
                    result.body.indexOf('UnhandledException') >= 0) {
                    result.statusCode = 500;
                }

                if (requestUrl !== responseUrl) {
                    result.redirectUrl = responseUrl;
                }

                return result;
            })
            .then(options.onProgress)
            .catch((error) => {
                return {
                    url: requestUrl,
                    error: error.cause.message
                };
            });
    });

    return Promise.all(urlRequests)
        .then(() => {
            // support bluebird-style .asCallback()
            return callback ? callback(null, urlRequests) : urlRequests;
        })
        .catch((error) => {
            return callback ? callback(error, urlRequests) : urlRequests;
        });
}


/**
 * Compares 2 result sets to find any changes.
 * @param  {object} opt
 * @return {array}
 */
function compare(opt) {
    const changedResults = [];

    const options = _.defaults(opt, {
        currentResults: [],
        previousResults: []
    });

    const currentResults = options.currentResults;
    const previousResults = options.previousResults;

    currentResults.forEach((currentResult) => {
        const previousResult = _.find(previousResults, (result) => {
            return currentResult.url === result.url;
        });

        if (!previousResult) {
            return;
        }

        if (currentResult.statusCode !== previousResult.statusCode) {
            changedResults.push({
                current: currentResult,
                previous: previousResult
            });
        }
    });

    return changedResults;
}


exports.check = check;
exports.compare = compare;
