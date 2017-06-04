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
		this.pollTimeout = 30000;
		
		console.log(`Mail.ru service successfully set up`);
		this.restoreSession();
    }
	
	restoreSession() {
		console.log(`Attempting to restore previous authorized mail.ru session`);
		const session_key = this.$cookies.get("mailru_token"), uid = this.$cookies.get("mailru_uid");
		if (session_key && uid) {
			console.log(`Mail.ru session key & uid restored from cookies: session_key=${session_key}, uid=${uid}`);
            this.connect(session_key, uid);
        }
		else {
			console.log(`No previous mail.ru session restored`);
		}
	}
	
	setClientId(clientId) {
		this.clientId = clientId;
	}
	
	makeSig(params) {
		const paramString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join("");
		const sigString = `${this.uid}${paramString}${this.privateKey}`;
		return md5(sigString);
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
		console.log(`Calling mail.ru API method ${methodName}: ${request}`);
		return this.$http.get(request);
	}
	
	initUser() {
		console.log(`Initializing mail.ru user`);
		return this.callApiMethod("users.getInfo").then(response => {
			if (response.data.error) {
				console.error(`Failed to initialize mail.ru user: ${JSON.stringify(response.data.error)}`);
				this.$cookies.remove('mailru_token');
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.data.error.error_msg };
			}
			const user = response.data[0];
			console.log(`mail.ru user: ${JSON.stringify(user)}`);
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
		console.log(`Polling...`);
		if (this.$rootScope.currentDialog && this.$rootScope.currentDialog.service === "mailru") {
			console.log(`Current dialog belongs to mail.ru`);
			this.$rootScope.$emit("rerenderMessages");
			this.$rootScope.$emit("scrollBottom");
		}
		this.$rootScope.$emit("updateDialogs");
	}
	
	setupPoller() {
		setInterval(() => this.poll(), this.pollTimeout);
		console.log("Poller initialized");
	}
	
	connect(token, uid) {
		this.token = token;
		this.uid = uid;
        this.connected = true;
		
		console.log(`Connecting to mail.ru...`);
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
		return this.callApiMethod("messages.getThread", { uid: thread.user.uid }).then(response => {
			if (response.data.error) {
				console.log(`Failed to load dialog messages: ${JSON.stringify(response.data.error)}`);
				this.$cookies.remove("mailru_token");
				this.$cookies.remove("mailru_uid");
				throw { service: this.name, message: response.data.error.error_msg };
			}
			return response.data.map(message => {
				console.log(`Processing message: ${JSON.stringify(message)}`);
				const isMy = message.type === 0;
				return {
					text: message.message.map(msg => String(msg.content)).join(""),
					date: new Date(message.time * 1000),
					photo: isMy ? this.$rootScope.mailru.photo : thread.user.pic,
					full_name: isMy ? this.$rootScope.mailru.full_name : `${thread.user.first_name} ${thread.user.last_name}`
				};
			}).reverse();
		});
	}
	
	sendDialogMessage(message, uid) {
		console.log(`Sending message ${JSON.stringify(message)} to user ${uid}`);
		return this.callApiMethod("messages.post", { uid, message });
	}
	
	getDialogs() {
		return this.callApiMethod("messages.getThreadsList").then(response => {
			if (response.data.error) {
				console.log(`Failed to load dialogs: ${JSON.stringify(response.data.error)}`);
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
					user_id: thread.user.uid,
					full_name: `${thread.user.first_name} ${thread.user.last_name}`,
					photo: thread.user.pic,
					getMessages: () => this.getDialogMessages(thread),
					sendMessage: message => this.sendDialogMessage(message, thread.user.uid),
					type: "1" //TODO conversations
				};
			});
		});
	}
}

app.service('mailruService', MailruService);