class BaseService {
    constructor(name) {
        this.name = name;
        this.connected = false;
    }
	
	buildRequestString(requestParams, config) {
		requestParams = requestParams || {};
		config = config || {};
		const sort = config.sort == null ? false : Boolean(config.sort);
		const joiner = config.joiner == null ? "&" : String(config.joiner);
		const keys = sort ? Object.keys(requestParams).sort() : Object.keys(requestParams);
		const keyValueMap = keys.map(key => `${key}=${requestParams[key]}`);
		return keyValueMap.join(joiner);
	}
	
	buildRequestURL(baseURL, requestParams, sort) {
		const requestString = this.buildRequestString(requestParams, { sort });
		return `${baseURL}?${requestString}`;
	}
}