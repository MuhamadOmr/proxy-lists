'use strict';

var _ = require('underscore');
var async = require('async');
var net = require('net');

var ProxyLists = module.exports = {

	defaultOptions: {
		/*
			Get proxies for the specified countries.

			To get all proxies, regardless of country, set this option to NULL.

			See:
			https://en.wikipedia.org/wiki/ISO_3166-1

			Only USA and Canada:
			['us', 'ca']
		*/
		countries: null,

		/*
			Get proxies that use the specified protocols.

			To get all proxies, regardless of protocol, set this option to NULL.
		*/
		protocols: ['http', 'https'],

		/*
			Anonymity level.

			To get all proxies, regardless of anonymity level, set this option to NULL.
		*/
		anonymityLevels: ['anonymous', 'elite'],

		/*
			Include proxy sources by name.

			Only 'freeproxylists':
			['freeproxylists']
		*/
		sourcesWhiteList: null,

		/*
			Exclude proxy sources by name.

			All proxy sources except 'freeproxylists':
			['freeproxylists']
		*/
		sourcesBlackList: null
	},

	_protocols: ['http', 'https', 'socks4', 'socks5'],
	_anonymityLevels: ['transparent', 'anonymous', 'elite'],
	_countries: require('./countries'),
	_sources: require('./sources'),

	// Get proxies from all sources.
	getProxies: function(options, cb) {

		if (_.isFunction(options)) {
			cb = options;
			options = null;
		}

		options = this.prepareOptions(options);

		var sources = this.listSources(options);

		async.map(sources, _.bind(function(source, next) {

			this.getProxiesFromSource(source.name, options, function(error, proxies) {

				if (error) {
					console.error(error.message || error);
				}

				next(null, proxies || []);
			});

		}, this), function(error, proxies) {

			if (error) {
				return cb(error);
			}

			// Collapse the multi-dimensional array.
			proxies = Array.prototype.concat.apply([], proxies);

			cb(null, proxies);
		});
	},

	// Get proxies from a single source.
	getProxiesFromSource: function(name, options, cb) {

		if (_.isFunction(options)) {
			cb = options;
			options = null;
		}

		if (!_.has(this._sources, name)) {
			throw new Error('Proxy source does not exist: "' + name + '"');
		}

		options = this.prepareOptions(options);

		this._sources[name].getProxies(options, function(error, proxies) {

			if (error) {
				return cb(error);
			}

			// Filter the proxies.
			proxies = ProxyLists.filterProxies(proxies, options);

			proxies = _.map(proxies, function(proxy) {
				proxy.source = name;
				return proxy;
			});

			cb(null, proxies);
		});
	},

	addSource: function(name, source) {

		if (!_.isString(name) || name.length === 0) {
			throw new Error('Invalid source name.');
		}

		if (_.has(this._sources, name)) {
			throw new Error('Source already exists: "' + name + '"');
		}

		if (!_.isObject(source) || _.isNull(source)) {
			throw new Error('Expected "source" to be an object.');
		}

		if (!_.isFunction(source.getProxies)) {
			throw new Error('Source missing required "getProxies" method.');
		}

		this._sources[name] = source;
	},

	listSources: function(options) {

		options || (options = {});

		var sourcesWhiteList = options.sourcesWhiteList && arrayToHash(options.sourcesWhiteList);
		var sourcesBlackList = options.sourcesBlackList && arrayToHash(options.sourcesBlackList);

		// Get an array of source names filtered by the options.
		var sourceNames = _.filter(_.keys(this._sources), function(name) {

			if (sourcesWhiteList) {
				return sourcesWhiteList[name];
			}

			if (sourcesBlackList) {
				return !sourcesBlackList[name];
			}

			return true;
		});

		return _.map(sourceNames, function(name) {

			var source = this._sources[name];

			return {
				name: name,
				homeUrl: source.homeUrl || ''
			};

		}, this);
	},

	filterProxies: function(proxies, options) {

		options || (options = {});

		var countriesTest;
		var protocolsTest;
		var anonymityLevelsTest;

		if (options.countries) {

			if (_.isArray(options.countries) || !_.isObject(options.countries)) {
				throw new Error('Invalid option "countries": Object expected.');
			}

			countriesTest = options.countries;
		}

		if (options.protocols) {

			protocolsTest = arrayToHash(options.protocols);
		}

		if (options.anonymityLevels) {

			anonymityLevelsTest = arrayToHash(options.anonymityLevels);
		}

		return _.filter(proxies, function(proxy) {

			if (countriesTest && !countriesTest[proxy.country]) {
				return false;
			}

			if (anonymityLevelsTest && !anonymityLevelsTest[proxy.anonymityLevel]) {
				return false;
			}

			if (protocolsTest) {

				var hasAtLeastOnePassingProtocol = _.some(proxy.protocols, function(protocol) {
					return protocolsTest[protocol];
				});

				if (!hasAtLeastOnePassingProtocol) {
					return false;
				}
			}

			return true;
		});
	},

	prepareOptions: function(options) {

		options = _.extend({}, this.defaultOptions, options || {});

		if (_.isNull(options.countries)) {
			// Use all countries.
			options.countries = _.keys(this._countries);
		}

		if (_.isNull(options.protocols)) {
			// Use all protocols.
			options.protocols = _.values(this._protocols);
		}

		if (_.isNull(options.anonymityLevels)) {
			// Use all anonymity levels.
			options.anonymityLevels = _.values(this._anonymityLevels);
		}

		if (!_.isArray(options.countries) && !_.isObject(options.countries)) {
			throw new Error('Invalid option "countries": Array or object expected.');
		}

		if (!_.isArray(options.protocols)) {
			throw new Error('Invalid option "protocols": Array expected.');
		}

		if (!_.isArray(options.anonymityLevels)) {
			throw new Error('Invalid option "anonymityLevels": Array expected.');
		}

		if (options.countries && _.isArray(options.countries)) {

			options.countries = _.object(_.map(options.countries, function(code) {
				return [code, this._countries[code]];
			}, this));
		}

		return options;
	},

	isValidProxy: function(proxy) {

		return !!proxy.ipAddress && this.isValidIpAddress(proxy.ipAddress) &&
				!!proxy.port && this.isValidPort(proxy.port) &&
				!!proxy.protocols && this.isValidProxyProtocols(proxy.protocols);
	},

	isValidPort: function(port) {

		return _.isNumber(port) && parseInt(port).toString() === port.toString();
	},

	isValidProxyProtocols: function(protocols) {

		return _.isArray(protocols) && protocols.length > 0 && _.every(protocols, function(protocol) {
			return ProxyLists.isValidProxyProtocol(protocol);
		});
	},

	isValidProxyProtocol: function(protocol) {

		return _.contains(this._protocols, protocol);
	},

	isValidIpAddress: function(ipAddress) {

		return net.isIP(ipAddress) !== 0;
	}
};

var arrayToHash = function(array) {

	return _.object(_.map(array, function(value) {
		return [value, true];
	}));
};
