class MailruService extends BaseService {
	constructor($rootScope, $window, $uibModal, $http, $cookies, toaster, $timeout) {
        super('Mail.ru');
        this.$window = $window;
        this.$uibModal = $uibModal;
        this.$http = $http;
        this.$rootScope = $rootScope;
        this.$cookies = $cookies;
        this.toaster = toaster;
        this.$timeout = $timeout;
		
		this.apiURL = "http://appsmail.ru/platform/api";
		this.privateKey = "7c97f09acae3d5dede5542ffecec1f77";
		this.pollTimeout = 5000;

        if ($cookies.get('mailru_token')) {
            this.connect($cookies.get('mailru_token'));
        }
    }
	
	setClientId(clientId) {
		this.clientId = clientId;
	}
	
	makeSig(params) {
		console.log(`Making signature from params: ${JSON.stringify(params)}`);
		const paramString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join("");
		console.log(`Sorted param string: ${paramString}`);
		const sigString = `${this.uid}${paramString}${this.privateKey}`;
		console.log(`Signature string: ${sigString}`);
		const md5sig = md5(sigString);
		console.log(`md5: ${md5sig}`);
		return md5sig;
	}
	
	callApiMethod(methodName, restParams) {
		restParams = restParams || {};
		const params = {
			app_id: this.clientId,
			method: methodName,
			session_key: this.token,
			secure: 0,
			format: "json"
		};
		Object.keys(restParams).forEach(key => params[key] = restParams[key]);
		const sig = this.makeSig(params);
		params.sig = sig;
		const requestParams = Object.keys(params).map(key => `${key}=${params[key]}`).join("&");
		const request = `${this.apiURL}?${requestParams}`;
		console.log(`Calling API: ${request}`);
		return this.$http.get(request);
	}
	
	initUser() {
		return this.callApiMethod("users.getInfo").then(response => {
			console.log("initUser=" + JSON.stringify(response));
			if (response.data.error) {
				this.$cookies.remove('mailru_token');
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.data.error.error_msg };
			}
			const user = response.data[0];
			this.$rootScope.mailru = {
				id: user.uid,
				full_name: `${user.first_name} ${user.last_name}`,
				photo: user.has_pic ? user.pic : ""
			};
		}).catch(err => {
			console.error("initUser failed:");
			console.error(err);
			this.toaster.pop("error", err.service, err.message);
		});
	}
	
	poll() {
		this.callApiMethod("messages.getUnreadCount").then(response => {
			console.log("Poll=" + JSON.stringify(response));
			if (response.data.count > 0) {
				if (this.$rootScope.currentDialog && this.$rootScope.currentDialog.service === "mailru") {
					this.$rootScope.$emit("rerenderMessages");
					this.$rootScope.$emit("scrollBottom");
				}
				this.$rootScope.$emit("updateDialogs");
			}
		});
	}
	
	setupPoller() {
		this.$timeout(() => this.poll(), this.pollTimeout);
		console.log("Poller initialized");
	}
	
	connect(token, uid) {
		this.token = token;
		this.uid = uid;
        this.connected = true;
		
		return this.initUser().then(() => this.setupPoller()).then(() => this.$rootScope.$emit("updateDialogs"));
	}
	
	auth() {
		const authURL = "https://connect.mail.ru/oauth/authorize";
		const redirectURI = "http://connect.mail.ru/oauth/success.html";
		const responseType = "token";
		const privileges = [ "photos", "messages" ];
		const scope = privileges.join(" ");
		const params = [
			`client_id=${this.clientId}`,
			`redirect_uri=${redirectURI}`,
			`response_type=${responseType}`,
			`scope=${scope}`
		].join("&");
		const authRequest = `${authURL}?${params}`;
		
		this.$window.open(authRequest, '_blank');
        let authModal = this.$uibModal.open({
            templateUrl: 'assets/html/mailruAuthModal.html',
            controller: function ($scope, $uibModalInstance) {
                $scope.cancel = () => $uibModalInstance.close();
                $scope.ok = () => $uibModalInstance.close({ token: $scope.token, uid: $scope.uid });
            }
        });
		
        authModal.result
            .then(({ token, uid }) => {
                this.$cookies.put('mailru_token', token);
				this.$cookies.put(`mailru_uid`, uid);
				console.log(`Authorization successful: token=${token}, uid=${uid}`);
                return this.connect(token, uid);
            });
	}
	
	getDialogMessages(thread) {
		this.callApiMethod("messages.getThread", { uid: thread.uid }).then(response => {
			console.log("getDialogMessages=" + JSON.stringify(response));
			if (response.data.error) {
				this.$cookies.remove("mailru_token");
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.data.error.error_msg };
			}
			return response.data.map(message => {
				console.log(`Processing message: ${JSON.stringify(message)}`);
				const isMy = message.type === 1;
				return {
					text: message.filtered_message,
					date: new Date(message.time * 1000),
					photo: isMy ? this.$rootScope.mailru.photo : thread.pic,
					full_name: isMy ? this.$rootScope.mailru.full_name : `${thread.first_name} ${thread.last_name}`
				};
			}).reverse();
		});
	}
	
	sendDialogMessage(message, uid) {
		this.callApiMethod("messages.post", { uid, message });
	}
	
	getDialogs() {
		this.callApiMethod("messages.getThreadsList").then(response => {
			console.log("getDialogs=" + JSON.stringify(response));
			if (response.data.error) {
				this.$cookies.remove("mailru_token");
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.data.error.error_msg };
			}
			return response.data.map(thread => {
				console.log(`Processing thread: ${JSON.stringify(thread)}`);
				return {
					service: "mailru",
					unread: Boolean(thread.unread),
					date: new Date(thread.time * 1000),
					user_id: thread.uid,
					full_name: `${thread.first_name} ${thread.last_name}`,
					photo: thread.pic,
					getMessages: () => this.getDialogMessages(thread),
					sendMessage: message => this.sendDialogMessage(message, thread.uid),
					type: "1" //TODO conversations
				};
			});
		});
	}
}

app.service('mailruService', MailruService);