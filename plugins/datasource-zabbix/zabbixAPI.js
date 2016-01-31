define([
  'angular',
  'lodash',
  './zabbixAPIService'
  ],
function (angular, _) {
  'use strict';

  var module = angular.module('grafana.services');

  /**
   * Zabbix API Wrapper.
   * Creates Zabbix API instance with given parameters (url, credentials and other).
   * Wraps API calls and provides high-level methods.
   */
  module.factory('ZabbixAPI', function($q, backendSrv, ZabbixAPIService) {

    // Initialize Zabbix API.
    function ZabbixAPI(api_url, username, password, basicAuth, withCredentials) {
      this.url              = api_url;
      this.username         = username;
      this.password         = password;
      this.auth             = "";

      this.requestOptions = {
        basicAuth: basicAuth,
        withCredentials: withCredentials
      };

      this.loginPromise = null;
    }

    var p = ZabbixAPI.prototype;

    //////////////////
    // Core methods //
    //////////////////

    p.request = function(method, params) {
      var self = this;
      return ZabbixAPIService.request(this.url, method, params, this.requestOptions, this.auth)
        .then(function(result) {
          return result;
        },

        // Handle errors
        function(error) {
          if (isAuthError(error.data)) {
            return self.loginOnce().then(function() {
              return self.request(method, params);
            });
          }
        });
    };

    function isAuthError(message) {
      return (
        message === "Session terminated, re-login, please." ||
        message === "Not authorised." ||
        message === "Not authorized."
      );
    }

    /**
     * When API unauthenticated or auth token expired each request produce login()
     * call. But auth token is common to all requests. This function wraps login() method
     * and call it once. If login() already called just wait for it (return its promise).
     * @return login promise
     */
    p.loginOnce = function() {
      var self = this;
      var deferred  = $q.defer();
      if (!self.loginPromise) {
        self.loginPromise = deferred.promise;
        self.login().then(function(auth) {
          self.loginPromise = null;
          self.auth = auth;
          deferred.resolve(auth);
        });
      } else {
        return self.loginPromise;
      }
      return deferred.promise;
    };

    /**
     * Get authentication token.
     */
    p.login = function() {
      return ZabbixAPIService.login(this.url, this.username, this.password, this.requestOptions);
    };

    /**
     * Get Zabbix API version
     */
    p.getVersion = function() {
      return ZabbixAPIService.getVersion(this.url, this.requestOptions);
    };

    /////////////////
    // API methods //
    /////////////////

    p.getGroups = function() {
      var params = {
        output: ['name'],
        sortfield: 'name'
      };

      return this.request('hostgroup.get', params);
    };

    p.getHosts = function() {
      var params = {
        output: ['name', 'host'],
        sortfield: 'name',
        selectGroups: []
      };

      return this.request('host.get', params);
    };

    p.getApplications = function() {
      var params = {
        output: ['name'],
        sortfield: 'name',
        selectHosts: []
      };

      return this.request('application.get', params);
    };

    p.getItems = function() {
      var params = {
        output: ['name', 'key_', 'value_type', 'hostid', 'status', 'state'],
        sortfield: 'name',
        selectApplications: []
      };

      return this.request('item.get', params);
    };

    /**
     * Perform history query from Zabbix API
     *
     * @param  {Array}  items       Array of Zabbix item objects
     * @param  {Number} time_from   Time in seconds
     * @param  {Number} time_till   Time in seconds
     * @return {Array}  Array of Zabbix history objects
     */
    p.getHistory = function(items, time_from, time_till) {
      var self = this;

      // Group items by value type
      var grouped_items = _.groupBy(items, 'value_type');

      // Perform request for each value type
      return $q.all(_.map(grouped_items, function (items, value_type) {
        var itemids = _.map(items, 'itemid');
        var params = {
          output: 'extend',
          history: value_type,
          itemids: itemids,
          sortfield: 'clock',
          sortorder: 'ASC',
          time_from: time_from
        };

        // Relative queries (e.g. last hour) don't include an end time
        if (time_till) {
          params.time_till = time_till;
        }

        return self.request('history.get', params);
      })).then(_.flatten);
    };

    /**
     * Perform trends query from Zabbix API
     * Use trends api extension from ZBXNEXT-1193 patch.
     *
     * @param  {Array}  items       Array of Zabbix item objects
     * @param  {Number} time_from   Time in seconds
     * @param  {Number} time_till   Time in seconds
     * @return {Array}  Array of Zabbix trend objects
     */
    p.getTrends = function(items, time_from, time_till) {
      var self = this;

      // Group items by value type
      var grouped_items = _.groupBy(items, 'value_type');

      // Perform request for each value type
      return $q.all(_.map(grouped_items, function (items, value_type) {
        var itemids = _.map(items, 'itemid');
        var params = {
          output: 'extend',
          trend: value_type,
          itemids: itemids,
          sortfield: 'clock',
          sortorder: 'ASC',
          time_from: time_from
        };

        // Relative queries (e.g. last hour) don't include an end time
        if (time_till) {
          params.time_till = time_till;
        }

        return self.request('trend.get', params);
      })).then(_.flatten);
    };

    p.getITService = function(/* optional */ serviceids) {
      var params = {
        output: 'extend',
        serviceids: serviceids
      };
      return this.request('service.get', params);
    };

    p.getSLA = function(serviceids, from, to) {
      var params = {
        serviceids: serviceids,
        intervals: [{
          from: from,
          to: to
        }]
      };
      return this.request('service.getsla', params);
    };

    p.getTriggers = function(limit, sortfield, groupids, hostids, applicationids, name) {
      var params = {
        output: 'extend',
        expandDescription: true,
        expandData: true,
        monitored: true,
        //only_true: true,
        filter: {
          value: 1
        },
        search : {
          description: name
        },
        searchWildcardsEnabled: false,
        groupids: groupids,
        hostids: hostids,
        applicationids: applicationids,
        limit: limit,
        sortfield: 'lastchange',
        sortorder: 'DESC'
      };

      if (sortfield) {
        params.sortfield = sortfield;
      }

      return this.request('trigger.get', params);
    };

    p.getAcknowledges = function(triggerids, from) {
      var params = {
        output: 'extend',
        objectids: triggerids,
        acknowledged: true,
        select_acknowledges: 'extend',
        sortfield: 'clock',
        sortorder: 'DESC',
        time_from: from
      };

      return this.request('event.get', params)
        .then(function (events) {
          return _.flatten(_.map(events, 'acknowledges'));
        });
    };

    return ZabbixAPI;

  });

});