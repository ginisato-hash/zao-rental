# Dependency and exclusion evidence supplied after P2 review1

Installed embedded-postgres 18.4.0-beta.17. Full dist/index.js SHA-256: `bf0e5908e56276c31d4e588785d5349427ba076dcd1e0d8ed4945c8ce3576c4e`. Source read locally; no dependency update. [Official repository and API](https://github.com/leinelissen/embedded-postgres) separates initialise and start. The excerpts below pin the installed code rather than assuming current upstream behavior.

Constructor stores options; start launches postgres against the existing -D directory. It does not call initialise. Our restore explicitly passes the original synthetic credential and verifies a wrong credential is rejected. This is not rotation.

## Installed dist/index.js lines 85–99

```js
85:     constructor(options = {}) {
86:         // Options were previously specified in snake_case rather than
87:         // camelCase. We still want to accept the old style of options.
88:         const legacyOptions = {};
89:         if (options.database_dir) {
90:             legacyOptions.databaseDir = options.database_dir;
91:         }
92:         if (options.auth_method) {
93:             legacyOptions.authMethod = options.auth_method;
94:         }
95:         // Assign default options to options object
96:         this.options = Object.assign({}, defaults, legacyOptions, options);
97:         instances.add(this);
98:         this.isRootUser = userInfo().uid === 0;
99:     }
```

## Installed dist/index.js lines 187–229

```js
187:     /**
188:      * Start the Postgres cluster with the given configuration. The cluster is
189:      * started as a seperate process, unmanaged by NodeJS. It is automatically
190:      * shut down when the script exits.
191:      */
192:     start() {
193:         return __awaiter(this, void 0, void 0, function* () {
194:             const { postgres } = yield bin;
195:             const locale = getBestLocale();
196:             // Optionally retrieve the uid and gid
197:             const permissionIds = yield this.getUidAndGid()
198:                 .catch(() => {
199:                 throw new Error('Postgres cannot run as a root user. embedded-postgres could not find a postgres user to run as instead. Consider using the `createPostgresUser` option.');
200:             });
201:             // Make the file executable, in case it is not
202:             ensureBinIsExecutable(postgres);
203:             yield new Promise((resolve, reject) => {
204:                 var _a;
205:                 // Spawn a postgres server
206:                 this.process = spawn(postgres, [
207:                     '-D',
208:                     this.options.databaseDir,
209:                     '-p',
210:                     this.options.port.toString(),
211:                     ...this.options.postgresFlags,
212:                 ], Object.assign(Object.assign({}, permissionIds), { env: Object.assign(Object.assign({}, process.env), { LC_MESSAGES: locale }) }));
213:                 // Connect to stderr, as that is where the messages get sent
214:                 (_a = this.process.stderr) === null || _a === void 0 ? void 0 : _a.on('data', (chunk) => {
215:                     // Parse the data as a string and log it
216:                     const message = chunk.toString('utf-8');
217:                     this.options.onLog(message);
218:                     // GUARD: Check for the right message to determine server start
219:                     if (message.includes('database system is ready to accept connections')) {
220:                         resolve();
221:                     }
222:                 });
223:                 // In case the process exits early, the promise is rejected.
224:                 this.process.on('close', () => {
225:                     reject();
226:                 });
227:             });
228:         });
229:     }
```

## Third-party license

MIT License

Copyright (c) 2022 Lei Nelissen

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
