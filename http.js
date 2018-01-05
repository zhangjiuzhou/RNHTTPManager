'use strict'
/**
 * Created by jiuzhou.zhang on 17/1/12.
 */

import { NativeModules, Platform } from 'react-native'
import NativeEventEmitter from 'NativeEventEmitter'
import { cancelable } from './cancelable'
import { createError } from './error'
import { isIOS } from './compat'

const methods = {
  get: 'GET',
  post: 'POST'
}

const requestBodyTypes = {
  form: 'form',
  json: 'json',
  text: 'text',
  multipart: 'multipart' // 未实现
}

const responseBodyTypes = {
  text: 'text',
  json: 'json',
  blob: 'blob' // 未实现
}

const cachePolicies = {
  useCache: 'default',
  noCache: 'noCache'
}

const errorTypes = {
  canceled: 'http.cancelled',
  notConnectedToInternet: 'http.notConnectedToInternet',
  timedOut: 'http.timedOut',
  serverCertificateUntrusted: 'http.serverCertificateUntrusted',
  requestFailed: 'http.requestFailed',
  parseResponseFailed: 'http.parseResponseFailed',
  unknown: 'http.unknown'
}

class RNHttpManager extends NativeEventEmitter {
  constructor () {
    super(NativeModules.RNHttpManager)
  }

  request (url, params, callback) {
    NativeModules.RNHttpManager.request(url, params, callback)
  }

  cancel (token) {
    NativeModules.RNHttpManager.cancelRequest(token)
  }
}

const networking = new RNHttpManager()

class Request {
  _startTime = Date.now()

  constructor (url, {
    method = methods.get,
    headers = undefined,
    query = undefined,
    requestBody = undefined,
    requestBodyType = requestBodyTypes.form,
    acceptContentTypes = undefined,
    responseBodyType = responseBodyTypes.text,
    timeout = 30,
    cachePolicies = cachePolicies.default
  } = {}) {
    this._url = url

    if (acceptContentTypes === undefined) {
      switch (responseBodyType) {
        case responseBodyType.json:
          acceptContentTypes = ['text/json', 'application/json']
          break

        case requestBodyType.text:
          acceptContentTypes = ['text/plain']
          break
      }
    }

    if (query) {
      for (let k in query) {
        if (query[k] !== undefined && query[k] !== null) {
          query[k] = '' + query[k]
        }
      }
    }

    this._params = {
      method,
      headers,
      query,
      requestBody,
      requestBodyType,
      acceptContentTypes,
      responseBodyType,
      timeout,
      cachePolicies
    }
    this._token = null
    this._events = []
  }

  send () {
    let canceled = false
    let promise = new Promise((resolve, reject) => {
      this._events.push(networking.addListener('onSuccess', (obj) => {
        if (obj.token === this._token) {
          if (obj.response.data) {
            if (!isIOS) {
              obj.response.data = JSON.parse(obj.response.data) || {}
            }
            resolve(obj.response)
          } else {
            reject(this._parseError(obj))
          }
          this._clearEvents()

          let timespan = Date.now() - this._startTime
          console.log(`Http request ${this._url} finished in ${timespan} ms`)
        }
      }))
      this._events.push(networking.addListener('onError', (obj) => {
        if (obj.token === this._token) {
          reject(this._parseError(obj))
          this._clearEvents()

          let timespan = Date.now() - this._startTime
          console.log(`Http request ${this._url} finished in ${timespan} ms`)
        }
      }))

      networking.request(this._url, this._params, (token) => {
        this._token = token
        if (canceled) {
          networking.cancel(this._token)
        }
      })
    })

    let cancel = cancelable(() => {
      if (this._token) {
        networking.cancel(this._token)
      } else {
        canceled = true
      }
    })

    return {
      promise,
      cancel
    }
  }

  _parseError (obj) {
    let { type: nativeType, code: nativeCode, message: nativeMessage } = obj.response.error
    let userInfo = { ...obj.response }
    delete userInfo.error
    let { type, code } = Platform.OS === 'ios' ? this._parseIOSError(nativeType, nativeCode) : this._parseAndroidError(nativeType, nativeCode)
    userInfo.nativeError = {
      type: nativeType,
      code: nativeCode,
      message: nativeMessage
    }
    return createError(type, code, nativeMessage, userInfo)
  }

  _parseAndroidError (nativeType, nativeCode) {
    let type
    let code = 0

    if (nativeType === 'IOException') {
      switch (nativeCode) {
        case -1000:
          type = errorTypes.canceled
          break
        case -1001:
          type = errorTypes.notConnectedToInternet
          break
        case -1002:
          type = errorTypes.timedOut
          break
        case -1003:
          type = errorTypes.serverCertificateUntrusted
          break
        default:
          type = errorTypes.requestFailed
          break
      }
    } else {
      type = errorTypes.unknown
    }

    return {
      type,
      code
    }
  }

  _parseIOSError (nativeType, nativeCode) {
    let type
    let code = 0

    if (nativeType === 'NSURLErrorDomain') {
      switch (nativeCode) {
        case -999: // NSURLErrorCancelled
          type = errorTypes.canceled
          break

        case -1009: // NSURLErrorNotConnectedToInternet
          type = errorTypes.notConnectedToInternet
          break

        case -1001: // NSURLErrorTimedOut
          type = errorTypes.timedOut
          break

        case -1200: // NSURLErrorSecureConnectionFailed
        case -1201: // NSURLErrorServerCertificateHasBadDate
        case -1202: // NSURLErrorServerCertificateUntrusted
        case -1203: // NSURLErrorServerCertificateHasUnknownRoot
        case -1204: // NSURLErrorServerCertificateNotYetValid
        case 310: // kCFErrorHTTPSProxyConnectionFailure
          type = errorTypes.serverCertificateUntrusted
          break

        default:
          type = errorTypes.requestFailed
          break
      }
    } else if (nativeType === 'com.alamofire.error.serialization.response') {
      type = errorTypes.parseResponseFailed
    } else {
      type = errorTypes.unknown
    }

    return {
      type,
      code
    }
  }

  _clearEvents () {
    for (let sub of this._events) {
      sub.remove()
    }
    this._events = []
  }
}

function request (url, options) {
  let request = new Request(url, options)
  return request.send()
}

function get (url, query = undefined, options = {}) {
  return request(url, {
    ...options,
    method: methods.get,
    query: query
  })
}

function post (url, requestBody = undefined, query = undefined, options = {}) {
  return request(url, {
    ...options,
    method: methods.post,
    requestBody: requestBody,
    query: query
  })
}

export {
  methods,
  requestBodyTypes,
  responseBodyTypes,
  cachePolicies,
  errorTypes,
  request,
  get,
  post
}
