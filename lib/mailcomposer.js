/*jslint node:true, nomen:true */
var fs = require('fs');
var _ = require('lodash-node');
var async = require('async');
var Errors = require('node-common-errors');
var jade = require('jade');
var path = require('path');

var PATH = './templates',
    mails;

var INIT_CALLED = false;
var isProd = process.env.NODE_ENV === 'production';
var activation_link, passwordreset_link;
var idProperty = null;

/**
 * Initialize mail composer
 * @param  {String} templatePath - where should we pick-up email templates
 */
function initialize(templatePath, config) {
	PATH = path.resolve(templatePath || PATH);
	mails = {};
	idProperty = config.idProperty;
	
	var domain = config.domain,
			protocol = config.protocol,
			pathActivate = config.pathActivate,
			pathResetPassword = config.pathResetPassword;

	var base = config.protocol + config.domain;

	activation_link = base + pathActivate;
	passwordreset_link = base + pathResetPassword;

	INIT_CALLED = true;
}


/**
 * Returns file contents with falling back to `default` language
 * @param {String}   path     - absolute file path
 * @param {Function} callback - <err, fileContent[String]>
 */
function readFilePathWithFallbackToDefaultLanguage(type, language, callback) {
	var filePath = PATH + '/' + language + '/' + type + '.jade';
	fs.readFile(filePath, 'utf-8', function readEmailTemplate(err, file) {
		// file doesnt exist
		if (err) {
			// fallback
			if (language !== 'default') {
				return readFilePathWithFallbackToDefaultLanguage(type, 'default', callback);
			}
			return callback(err);
		}

		return callback(null, file);
	});
}


/**
 * Returns template
 * @param {String}   type     - template name
 * @param {String}   language - template language
 * @param {Function} callback - <err, template>
 */
function getTemplate(type, language, callback) {
	var templateFunction;
	var key = type + language;

	// cache compiled templates in prod
	if (isProd) {
		templateFunction = mails[key];
		if (templateFunction) {
			return callback(null, templateFunction);
		}
	}

	readFilePathWithFallbackToDefaultLanguage(type, language, function compileJadeFile(err, file) {
		if (err) {
			return callback(err);
		}

		templateFunction = jade.compile(file);

		if (isProd) {
			mails[key] = templateFunction;
		}

		callback(null, templateFunction);
	});

}

/**
 * Compile template with `type`, `language` and `config`
 * @param {String}   type     - type of template to use
 * @param {String}   lang     - language of the template
 * @param {Object}   config   - local variables used to create links for the templates
 * @param {Function} callback - <err, compiledTemplate|String>
 */
function compileTemplateWithData(type, lang, config, callback) {
	if (!INIT_CALLED) {
		return callback(new Errors.Uninitialized());
	}

	if (!config.code || !config.email || !config.id) {
		return callback(new Errors.Internal('`config.code` or `config.email` or `config.id` are not defined'));
	}

	var link_querystring = 	'?code=' + encodeURIComponent(config.code) +
					'&email=' + encodeURIComponent(config.email) +
					'&' + idProperty + '=' + encodeURIComponent(config.id);

	// use this reference for allowing people
	// to override templateGet function if they really
	// want to
	this.get(type, lang, function processCompledTemplate(err, template) {
		if (err) {
				return callback(err);
		}

		if (!template) {
			return callback(new Errors.Internal('Template Not Found'));
		}

		var html = template({
			activation_link: activation_link,
			passwordreset_link: passwordreset_link,
			link_querystring: link_querystring
		});

		callback(null, html);
	});

}

var publicApi = {
	init: initialize,
	get: getTemplate
};

publicApi.compile = compileTemplateWithData.bind(publicApi);

/**
 * Public API
 * @type {Object}
 */
module.exports = publicApi;
