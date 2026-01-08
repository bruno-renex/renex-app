(function () {
  'use strict';

  function promisifyRequest(request) {
    return new Promise(function (resolve, reject) {
      request.oncomplete = request.onsuccess = function () {
        resolve(request.result);
      };
      request.onabort = request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function createStore(dbName, storeName) {
    var request = indexedDB.open(dbName);
    request.onupgradeneeded = function () {
      request.result.createObjectStore(storeName);
    };
    var dbp = promisifyRequest(request);
    return function (txMode, callback) {
      return dbp.then(function (db) {
        return callback(db.transaction(storeName, 
txMode).objectStore(storeName));
      });
    };
  }

  var defaultGetStore = createStore('keyval-store', 'keyval');

  function get(key, store = defaultGetStore) {
    return store('readonly', function (store) {
      return promisifyRequest(store.get(key));
    });
  }

  function set(key, value, store = defaultGetStore) {
    return store('readwrite', function (store) {
      store.put(value, key);
      return promisifyRequest(store.transaction);
    });
  }

  window.idbKeyval = { get, set };
})();
