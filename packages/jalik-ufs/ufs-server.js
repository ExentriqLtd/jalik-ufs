/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2017 Karl STEIN
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */
import {_} from "meteor/underscore";
import {Meteor} from "meteor/meteor";
import {WebApp} from "meteor/webapp";
import {UploadFS} from "./ufs";


if (Meteor.isServer) {

    const domain = Npm.require('domain');
    const fs = Npm.require('fs');
    const http = Npm.require('http');
    const https = Npm.require('https');
    const mkdirp = Npm.require('mkdirp');
    const stream = Npm.require('stream');
    const URL = Npm.require('url');
    const zlib = Npm.require('zlib');


    Meteor.startup(() => {
        let path = UploadFS.config.tmpDir;
        let mode = UploadFS.config.tmpDirPermissions;

        fs.stat(path, (err) => {
            if (err) {
                // Create the temp directory
                mkdirp(path, {mode: mode}, (err) => {
                    if (err) {
                        console.error(`ufs: cannot create temp directory at "${path}" (${err.message})`);
                    } else {
                        console.log(`ufs: temp directory created at "${path}"`);
                    }
                });
            } else {
                // Set directory permissions
                fs.chmod(path, mode, (err) => {
                    err && console.error(`ufs: cannot set temp directory permissions ${mode} (${err.message})`);
                });
            }
        });
    });

    // Create domain to handle errors
    // and possibly avoid server crashes.
    let d = domain.create();

    d.on('error', (err) => {
        console.error('ufs: ' + err.message);
    });

    // Listen HTTP requests to serve files
    WebApp.connectHandlers.use((req, res, next) => {
        // Quick check to see if request should be catch
        if (req.url.indexOf(UploadFS.config.storesPath) === -1) {
            next();
            return;
        }

        // Remove store path
        let parsedUrl = URL.parse(req.url);
        let path = parsedUrl.pathname.substr(UploadFS.config.storesPath.length + 1);

        let allowCORS = () => {
            // res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
            res.setHeader("Access-Control-Allow-Methods", "POST");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        };

        if (req.method === "OPTIONS") {
            let regExp = new RegExp('^\/([^\/\?]+)\/([^\/\?]+)$');
            let match = regExp.exec(path);

            // Request is not valid
            if (match === null) {
                res.writeHead(400);
                res.end();
                return;
            }

            // Get store
            let store = UploadFS.getStore(match[1]);
            if (!store) {
                res.writeHead(404);
                res.end();
                return;
            }

            // If a store is found, go ahead and allow the origin
            allowCORS();

            next();
        }
        else if (req.method === 'POST') {
            // Get store
            let regExp = new RegExp('^\/([^\/\?]+)\/([^\/\?]+)$');
            let match = regExp.exec(path);

            // Request is not valid
            if (match === null) {
                res.writeHead(400);
                res.end();
                return;
            }

            // Get store
            let store = UploadFS.getStore(match[1]);
            if (!store) {
                res.writeHead(404);
                res.end();
                return;
            }

            // If a store is found, go ahead and allow the origin
            allowCORS();

            // Get file
            let fileId = match[2];
            if (store.getCollection().find({_id: fileId}).count() === 0) {
                res.writeHead(404);
                res.end();
                return;
            }

            // Check upload token
            if (!store.checkToken(req.query.token, fileId)) {
                res.writeHead(403);
                res.end();
                return;
            }

            let tmpFile = UploadFS.getTempFilePath(fileId);
            let ws = fs.createWriteStream(tmpFile, {flags: 'a'});
            let fields = {uploading: true};
            let progress = parseFloat(req.query.progress);
            if (!isNaN(progress) && progress > 0) {
                fields.progress = Math.min(progress, 1);
            }

            req.on('data', (chunk) => {
                ws.write(chunk);
            });
            req.on('error', (err) => {
                res.writeHead(500);
                res.end();
            });
            req.on('end', Meteor.bindEnvironment(() => {
                // Update completed state without triggering hooks
                store.getCollection().direct.update({_id: fileId}, {$set: fields});
                ws.end();
            }));
            ws.on('error', (err) => {
                console.error(`ufs: cannot write chunk of file "${fileId}" (${err.message})`);
                fs.unlink(tmpFile, (err) => {
                    err && console.error(`ufs: cannot delete temp file "${tmpFile}" (${err.message})`);
                });
                res.writeHead(500);
                res.end();
            });
            ws.on('finish', () => {
                res.writeHead(204, {"Content-Type": 'text/plain'});
                res.end();
            });
        }
        else if (req.method == 'GET') {
          res.writeHead(404);
          res.end();
        } else {
            next();
        }
    });
}
