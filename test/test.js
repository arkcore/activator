/*jslint node:true, nomen:true, debug:true */
/*global should, describe, before, beforeEach, it, escape */

var request = require('supertest'),
    should = require('should'),
    express = require('express'),
		bodyParser = require('body-parser'),
    app = express(),
		server = require('http').createServer(app),
    _ = require('lodash-node'),
    async = require('async'),
    smtp = require('smtp-tester'),
    r = request(server),
    fs = require('fs'),
    activator = require('../lib/activator'),
    templates = __dirname + '/resources',
    Errors = require('node-common-errors');

var mail, users
    USERS = {
        "1": {
            id: "1",
            email: "example@hotmail.com",
            password: "1234"
        }
    };

function sendError(res, err) {
  var msg = { message: err.message, data: err.data };
  res.status(err.code).json(msg);
}

var quote = function (regex) {
        /*jslint regexp:true */
        var ret = regex.replace(/([()[{*+.$^\\/\\|?])/g, '\\$1');
        /*jslint regexp:false */
        return (ret);
    },

    userModel = {
        _find: function (query, cb) {
            var found = null;
            if (!query) {
                return cb(new Errors.Common("nologin", 500));
            }

            // possible login or email
            var login = _.values(query)[0];

            if (users[login]) {
                cb(null, _.cloneDeep(users[login]));
            } else {
                _.each(users, function (val) {
                    if (val && val.email === login) {
                        found = val;
                        return (false);
                    }
                });
                cb(null, _.cloneDeep(found));
            }

        },
        find: function () {
            this._find.apply(this, arguments);
        },
        save: function (id, model, cb) {
          if (id && users[id]) {

            if (model.$set) {
              _.extend(users[id], model.$set);
            }

            if (model.$unset) {
              users[id] = _.omit(users[id], Object.keys(model.$unset));
            }

            cb(null);
          } else {
            cb(404);
          }
        }
    },

    reset = function () {
        users = _.cloneDeep(USERS);
        if (mail && mail.removeAll) {
            mail.removeAll();
        }
    },

    userModelEmail = _.extend({}, userModel, {
        find: function (login, cb) {
            this._find(login, function (err, res) {
                if (res && res.email) {
                    res.funny = res.email;
                    delete res.email;
                }
                cb(err, res);
            });
        }
    }),

    MAILPORT = 30111,

		smtpConfig = {
			port: MAILPORT,
			host: 'localhost',
			tls: { rejectUnauthorized: false },
      // debug: true
		},

		createUser = function (req, res, next) {
      users["2"] = {
          id: "2",
          email: "you@hotmail.com",
          password: "5678"
      };
      req.activator = {
          id: "2",
          body: "2"
      };
      next();
    },

    splitTemplate = function (path) {
        /*jslint stupid:true */
        var content = fs.readFileSync(path, 'utf8');
        /*jslint stupid:false */
        content = content.match(/^([^\n]*)\n[^\n]*\n((.|\n)*)/m);
        return (content);
    },

    genHandler = function (email, subject, path, data, cb) {
        if (!cb) {
            cb = data;
            data = null;
        }
        return function (rcpt, msgid, content) {
            var url,
                ret,
                re = new RegExp('http:\\/\\/\\S*' + path.replace(/\//g, '\\/') + '\\?code=([^\\s\\&]+)\\&email=(\\S+)\\&id=([^\\s\\&"]+)');

            rcpt.should.eql(email);
            // check for the correct Subject in the email
            should.exist(content.data);
            content.headers.subject.should.eql(subject);
            // do we have actual content to test? if so, we should ignore templates, because we do not have the request stuff
            if (data && data.text) {
                should.exist(content.text);
                url = content.text.match(re);
                should.exist(url);
                // check that code and email match what is in database
                url.length.should.eql(4);
                ret = _.object(["path", "code", "email", "user"], url);
                ret.email.should.eql(email);
            }
            if (data && data.html) {
                should.exist(content.html);
                url = content.html.match(re);
                should.exist(url);
                // check that code and email match what is in database
                url.length.should.eql(4);
                ret = _.object(["path", "code", "email", "user"], url);
                ret.email.should.eql(encodeURIComponent(email));
            }
            if (!ret) {
                url = content.html.match(re);
                should.exist(url);
                // check that code and email match what is in database
                url.length.should.eql(4);
                ret = _.object(["path", "code", "email", "user"], url);
                ret.email.should.eql(encodeURIComponent(email));
            }
            cb(null, ret);
        };
    },

    aHandler = function (email, data, cb) {
        return genHandler(email, "Activate Your Account", '/api/1/users/activate', data, cb);
    },

    rHandler = function (email, data, cb) {
        return genHandler(email, "Reset Password", '/api/1/users/forgot', data, cb);
    },

		createActivateHandlerError = function (err, req, res, next) {
				// the header is not normally set, so we know we incurred the handler
				res.setHeader("activator", "createActivateHandler");
				sendError(res, err);
		},

    createActivateHandler = function (req, res, next) {
        // the header is not normally set, so we know we incurred the handler
        res.setHeader("activator", "createActivateHandler");
        res.status(req.activator.code).send(req.activator.message);
    },

		completeActivateHandlerError = function (err, req, res, next) {
				// the header is not normally set, so we know we incurred the handler
				res.setHeader("activator", "completeActivateHandler");
				sendError(res, err);
		},

    completeActivateHandler = function (req, res, next) {
        // the header is not normally set, so we know we incurred the handler
        res.setHeader("activator", "completeActivateHandler");
        res.status(req.activator.code).send(req.activator.message);
    },

    createResetHandlerError = function (err, req, res, next) {
				// the header is not normally set, so we know we incurred the handler
				res.setHeader("activator", "createResetHandler");
				sendError(res, err);
		},

		createResetHandler = function (req, res, next) {
        // the header is not normally set, so we know we incurred the handler
        res.setHeader("activator", "createResetHandler");
        res.status(req.activator.code).send(req.activator.message);
    },

		completeResetHandlerError = function (err, req, res, next) {
				// the header is not normally set, so we know we incurred the handler
				res.setHeader("activator", "completeResetHandler");
				sendError(res, err);
		},

    completeResetHandler = function (req, res, next) {
        // the header is not normally set, so we know we incurred the handler
        res.setHeader("activator", "completeResetHandler");
        res.status(req.activator.code).send(req.activator.message);
    };


before(function () {
    debugger;
});

before(function () {
    reset();
});

describe('activator', function () {
    before(function () {
        mail = smtp.init(MAILPORT);
				mail.module('logAll');
        app.use(bodyParser.json());
        app.post('/usersbad', activator.createActivate);
        app.post('/users', createUser, activator.createActivate);
        app.post('/usersnext', createUser, activator.createActivateNext, createActivateHandler, createActivateHandlerError);
        app.put('/users/:id/activate', activator.completeActivate);
        app.put('/usersnext/:id/activate', activator.completeActivateNext, completeActivateHandler, completeActivateHandlerError);
        app.post('/passwordreset', activator.createPasswordReset);
        app.put('/passwordreset/:id', activator.completePasswordReset);
        app.post('/passwordresetnext', activator.createPasswordResetNext, createResetHandler, createResetHandlerError);
        app.put('/passwordresetnext/:id', activator.completePasswordResetNext, completeResetHandler, completeResetHandlerError);
    });

		describe('not initialized', function () {

				it('activate should send 500', function (done) {
            r.post('/users').type("json").send({
                id: "john"
            }).expect(500, done);
        });

        it('completeactivate should send 500', function (done) {
            r.put('/users/1/activate').type("json").send({
                code: "12345"
            }).expect(500, done);
        });

        it('passwordreset should send 500', function (done) {
            r.post('/passwordreset').type("json").send({
                id: "john"
            }).expect(500, done);
        });

        it('completepasswordreset should send 500', function (done) {
            r.put('/passwordreset/1').type("json").send({
                password: "abcd",
                code: "12345"
            }).expect(500, done);
        });

        it('activatenext should send 500', function (done) {
            r.post('/usersnext').type("json").send({
                id: "john"
            }).expect('activator', 'createActivateHandler').expect(500, done);
        });

        it('completeactivatenext should send 500', function (done) {
            r.put('/usersnext/1/activate').type("json").send({
                code: "12345"
            }).expect('activator', 'completeActivateHandler').expect(500, done);
        });

        it('passwordresetnext should send 500', function (done) {
            r.post('/passwordresetnext').type("json").send({
                id: "john"
            }).expect('activator', 'createResetHandler').expect(500, done);
        });

        it('completepasswordresetnext should send 500', function (done) {
            r.put('/passwordresetnext/1').type("json").send({
                password: "abcd",
                code: "12345"
            }).expect('activator', 'completeResetHandler').expect(500, done);
        });

    });

    describe('initialized', function () {
        before(function () {
            activator.init({
                user: userModel,
                smtp: smtpConfig,
                templates: templates,
                from: 'test@gopickup.net',
                idProperty: 'id'
            });
        });
        beforeEach(reset);

        describe('activate', function () {

						it('should send 400 for user property not added', function (done) {
                r.post('/usersbad').expect(400, done);
            });

            it('should fail for known user but bad code', function (done) {
                var email, handler;
                async.waterfall([
                    function createUser(cb) {
                        r.post('/users').expect(201, "2", cb);
                    },
                    function (res, cb) {
                        email = users["2"].email;
                        handler = aHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/users/' + res.user + '/activate').type("json").send({
                            code: "asasqsqsqs"
                        }).expect(403, 'Forbidden', cb);
                    }
                ], done);
            });

            it('should fail for known user but bad code with handler', function (done) {
                var email, handler;
                async.waterfall([
                    function (cb) {
                        r.post('/usersnext').expect('activator', 'createActivateHandler').expect(201, cb);
                    },
                    function (res, cb) {
                        email = users["2"].email;
                        handler = aHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/usersnext/' + res.user + '/activate').type("json").send({
                            code: "asasqsqsqs"
                        }).expect('activator', 'completeActivateHandler').expect(403, cb);
                    }
                ], done);
            });

            it('should succeed for known user', function (done) {
                var email, handler;
                async.waterfall([
                    function (cb) {
                        r.post('/users').expect(201, cb);
                    },
                    function (res, cb) {
                        res.text.should.equal("2");
                        email = users["2"].email;
                        handler = aHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/users/' + res.user + '/activate').type("json").send({
                            code: res.code
                        }).expect(200, cb);
                    }
                ], done);
            });

            it('should succeed for known user with handler', function (done) {
                var email, handler;
                async.waterfall([
                    function (cb) {
                        r.post('/usersnext').expect('activator', 'createActivateHandler').expect(201, cb);
                    },
                    function (res, cb) {
                        res.text.should.equal("2");
                        email = users["2"].email;
                        handler = aHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/usersnext/' + res.user + '/activate').type("json").send({
                            code: res.code
                        }).expect('activator', 'completeActivateHandler').expect(200, cb);
                    }
                ], done);
            });
        });

        describe('password reset', function () {

            it('should send 400 for no email or ID passed', function (done) {
                r.post("/passwordreset").expect(400, done);
            });

            it('should send 400 for no email or ID passed with handler', function (done) {
                r.post("/passwordresetnext").expect('activator', 'createResetHandler').expect(400, done);
            });

            it('should send 404 for unknown email or ID', function (done) {
                r.post("/passwordreset").type('json').send({
                    email: "john@localhost"
                }).expect(404, done);
            });

            it('should send 404 for unknown email or ID with handler', function (done) {
                r.post("/passwordresetnext").type('json').send({
                    email: "john@localhost"
                }).expect('activator', 'createResetHandler').expect(404, done);
            });

            it('should fail for known email but bad code', function (done) {
                var email = users["1"].email,
                    handler;

                async.waterfall([
                    function (cb) {
                        r.post('/passwordreset').type('json').send({
                            email: email
                        }).expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordreset/' + res.user).type("json").send({
                            code: "asasqsqsqs",
                            password: "asasa"
                        }).expect(400, cb);
                    }
                ], done);
            });
            it('should fail for known email but bad code with handler', function (done) {
                var email = users["1"].email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordresetnext').type('json').send({
                            email: email
                        }).expect('activator', 'createResetHandler').expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordresetnext/' + res.user).type("json").send({
                            code: "asasqsqsqs",
                            password: "asasa"
                        }).expect('activator', 'completeResetHandler').expect(400, cb);
                    }
                ], done);
            });
            it('should fail for known email with good code but missing new password', function (done) {
                var email = users["1"].email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordreset').type('json').send({
                            email: email
                        }).expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordreset/' + res.user).type("json").send({
                            code: res.code
                        }).expect(400, cb);
                    }
                ], done);
            });
            it('should fail for known email with good code but missing new password with handler', function (done) {
                var email = users["1"].email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordresetnext').type('json').send({
                            email: email
                        }).expect('activator', 'createResetHandler').expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordresetnext/' + res.user).type("json").send({
                            code: res.code
                        }).expect('activator', 'completeResetHandler').expect(400, cb);
                    }
                ], done);
            });
            it('should fail for expired reset code', function (done) {
                var user = users["1"],
                    email = user.email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordreset').type('json').send({
                            email: email
                        }).expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        user.password_reset_time = 100;
                        r.put('/passwordreset/' + res.user).type("json").send({
                            code: res.code,
                            password: "abcdefgh"
                        }).expect(400, cb);
                    }
                ], done);
            });

            it('should fail for expired reset code with handler', function (done) {
                var user = users["1"],
                    email = user.email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordresetnext').type('json').send({
                            email: email
                        }).expect('activator', 'createResetHandler').expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        user.password_reset_time = 100;
                        r.put('/passwordresetnext/' + res.user).type("json").send({
                            code: res.code,
                            password: "abcdefgh"
                        }).expect('activator', 'completeResetHandler').expect(400, cb);
                    }
                ], done);
            });

            it('should succeed for known email', function (done) {
                var email = users["1"].email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordreset').type('json').send({
                            email: email
                        }).expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordreset/' + res.user).type("json").send({
                            code: res.code,
                            password: "abcdefgh"
                        }).expect(200, cb);
                    }
                ], done);
            });

            it('should succeed for known email with handler', function (done) {
                var email = users["1"].email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordresetnext').type('json').send({
                            email: email
                        }).expect('activator', 'createResetHandler').expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordresetnext/' + res.user).type("json").send({
                            code: res.code,
                            password: "abcdefgh"
                        }).expect('activator', 'completeResetHandler').expect(200, cb);
                    }
                ], done);
            });
        });
        describe('with email property override', function () {
            before(function () {
                activator.init({
                    user: userModelEmail,
                    emailProperty: 'funny',
                    smtp: smtpConfig,
                    templates: templates,
                    from: 'test@gopickup.net',
                    idProperty: 'id'
                });
            });

            it('activate should succeed for known user', function (done) {
                var email, handler;
                async.waterfall([
                    function (cb) {
                        r.post('/users').expect(201, cb);
                    },
                    function (res, cb) {
                        res.text.should.equal("2");
                        email = users["2"].email;
                        handler = aHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/users/' + res.user + '/activate').type("json").send({
                            code: res.code
                        }).expect(200, cb);
                    }
                ], done);
            });

            it('password reset should succeed for known email', function (done) {
                var email = users["1"].email,
                    handler;

                async.waterfall([
                    function (cb) {
                        r.post('/passwordreset').type('json').send({
                            funny: email
                        }).expect(201, cb);
                    },

                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },

                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordreset/' + res.user).type("json").send({
                            code: res.code,
                            password: "abcdefgh"
                        }).expect(200, cb);
                    }
                ], done);
            });
        });
        describe('with id property override', function () {
            before(function () {
                activator.init({
                    user: userModel,
                    smtp: smtpConfig,
                    from: 'test@gopickup.net',
                    templates: templates,
                    idProperty: 'id'
                });
            });
            it('activate should succeed for known user', function (done) {
                var email, handler, id;
                async.waterfall([

                    function (cb) {
                        r.post('/users').type('json').send({
                            email: "foo@localhost"
                        }).expect(201, cb);
                    },

                    function (res, cb) {
                        res.text.should.equal("2");
                        id = users["2"].id;
                        email = users["2"].email;
                        handler = aHandler(email, cb);
                        mail.bind(email, handler);
                    },

                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/users/' + id + '/activate').type("json").send({
                            code: res.code
                        }).expect(200, cb);
                    }
                ], done);
            });
            it('password reset should succeed for known email', function (done) {
                var email = users["1"].email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordreset').type('json').send({
                            email: email
                        }).expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordreset/' + email).type("json").send({
                            code: res.code,
                            password: "abcdefgh"
                        }).expect(200, cb);
                    }
                ], done);
            });
        });

        describe('with html emails', function () {
            var htemplate, prtemplate, templatesPath;
            before(function () {
                templatesPath = templates;
                activator.init({
                    user: userModel,
                    smtp: smtpConfig,
                    templates: templatesPath,
                    from: 'test@gopickup.net',
                    idProperty: 'id'
                });

                /*jslint stupid:true */
                htemplate = fs.readFileSync(templatesPath + '/default/activate.jade', 'utf-8');
                prtemplate = fs.readFileSync(templatesPath + '/default/passwordreset.jade', 'utf-8');
                /*jslint stupid:false */
            });
            it('activate should send html', function (done) {
                var email, handler;
                async.waterfall([
                    function (cb) {
                        r.post('/usersnext').expect(201, "2", cb);
                    },
                    function (res, cb) {
                        res.text.should.equal("2");
                        email = users["2"].email;
                        handler = aHandler(email, {
                            html: htemplate
                        }, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        cb();
                    }
                ], done);
            });

            it('password reset should send only html', function (done) {
                var email = users["1"].email,
                    handler;
                async.waterfall([
                    function (cb) {
                        r.post('/passwordreset').type('json').send({
                            email: email
                        }).expect(201, cb);
                    },
                    function (res, cb) {
                        handler = rHandler(email, cb);
                        mail.bind(email, handler);
                    },
                    function (res, cb) {
                        mail.unbind(email, handler);
                        r.put('/passwordreset/1').type("json").send({
                            code: res.code,
                            password: "abcdefgh"
                        }).expect(200, cb);
                    }
                ], done);
            });
        });
    });
});