import {AbstractInteractionsProvider} from '@aws-amplify/interactions/src/Providers';
import {
  InteractionsOptions,
  InteractionsResponse,
  InteractionsMessage,
} from '@aws-amplify/interactions/src/types';
import {
  LexRuntimeServiceClient,
  PostTextCommand,
  PostContentCommand,
} from '@aws-sdk/client-lex-runtime-service';
import {
  ConsoleLogger as Logger,
  Credentials,
  getAmplifyUserAgent,
} from '@aws-amplify/core';
import {Auth} from '@aws-amplify/auth';
import {convert} from '@aws-amplify/interactions/src/Providers/AWSLexProviderHelper/utils';
// import {convert} from '@aws-amplify/interactions/'

const logger = new Logger('myLexProvider');

export class myLexProvider extends AbstractInteractionsProvider {
  private lexRuntimeServiceClient: LexRuntimeServiceClient;
  private _botsCompleteCallback: object;

  constructor(options: InteractionsOptions = {}) {
    super(options);
    this._botsCompleteCallback = {};
  }

  getProviderName() {
    return 'myLexProvider';
  }

  reportBotStatus(data, botname) {
    // Check if state is fulfilled to resolve onFullfilment promise
    logger.debug('postContent state', data.dialogState);
    if (
      data.dialogState === 'ReadyForFulfillment' ||
      data.dialogState === 'Fulfilled'
    ) {
      if (typeof this._botsCompleteCallback[botname] === 'function') {
        setTimeout(
          () => this._botsCompleteCallback[botname](null, {slots: data.slots}),
          0,
        );
      }

      if (
        this._config &&
        typeof this._config[botname].onComplete === 'function'
      ) {
        setTimeout(
          () => this._config[botname].onComplete(null, {slots: data.slots}),
          0,
        );
      }
    }

    if (data.dialogState === 'Failed') {
      if (typeof this._botsCompleteCallback[botname] === 'function') {
        setTimeout(
          () => this._botsCompleteCallback[botname]('Bot conversation failed'),
          0,
        );
      }

      if (
        this._config &&
        typeof this._config[botname].onComplete === 'function'
      ) {
        setTimeout(
          () => this._config[botname].onComplete('Bot conversation failed'),
          0,
        );
      }
    }
  }

  async sendMessage(
    botname: string,
    message: string | InteractionsMessage | object,
  ): Promise<InteractionsResponse> {
    if (!this._config[botname]) {
      return Promise.reject('Bot ' + botname + ' does not exist');
    }
    const credentials = await Credentials.get();
    if (!credentials) {
      return Promise.reject('No credentials');
    }

    this.lexRuntimeServiceClient = new LexRuntimeServiceClient({
      region: this._config[botname].region,
      credentials,
      customUserAgent: getAmplifyUserAgent(),
    });

    let params;
    if (typeof message === 'string') {
      const userInfo = await Auth.currentUserInfo();
      params = {
        botAlias: this._config[botname].alias,
        botName: botname,
        inputText: message,
        userId: userInfo.username,
      };

      logger.debug('postText to LEX', message);

      try {
        const postTextCommand = new PostTextCommand(params);
        const data = await this.lexRuntimeServiceClient.send(postTextCommand);
        logger.debug('RESPONSE: ', data);
        this.reportBotStatus(data, botname);
        return data;
      } catch (err) {
        return Promise.reject(err);
      }
    } else if (
      typeof message === 'object' &&
      message.hasOwnProperty('sessionAttributes')
    ) {
      const {inputText, sessionAttributes} = (message as any) || {};
      const userInfo = await Auth.currentUserInfo();
      params = {
        botAlias: this._config[botname].alias,
        botName: botname,
        inputText,
        userId: userInfo.username,
        sessionAttributes,
      };

      logger.debug('postText to LEX', message);

      try {
        const postTextCommand = new PostTextCommand(params);
        const data = await this.lexRuntimeServiceClient.send(postTextCommand);
        logger.debug('RESPONSE: ', data);
        this.reportBotStatus(data, botname);
        return data;
      } catch (err) {
        return Promise.reject(err);
      }
    } else {
      const {
        content,
        options: {messageType},
      } = message as InteractionsMessage;
      if (messageType === 'voice') {
        params = {
          botAlias: this._config[botname].alias,
          botName: botname,
          contentType: 'audio/x-l16; sample-rate=16000',
          inputStream: content,
          userId: credentials.identityId,
          accept: 'audio/mpeg',
        };
      } else {
        params = {
          botAlias: this._config[botname].alias,
          botName: botname,
          contentType: 'text/plain; charset=utf-8',
          inputStream: content,
          userId: credentials.identityId,
          accept: 'audio/mpeg',
        };
      }
      logger.debug('postContent to lex', message);
      try {
        const postContentCommand = new PostContentCommand(params);
        const data = await this.lexRuntimeServiceClient.send(
          postContentCommand,
        );
        const audioArray = await convert(data.audioStream);
        // const audioArray: any[] = [];
        this.reportBotStatus(data, botname);
        return {...data, ...{audioStream: audioArray}};
      } catch (err) {
        return Promise.reject(err);
      }
    }
  }

  onComplete(botname: string, callback) {
    if (!this._config[botname]) {
      throw new ErrorEvent('Bot ' + botname + ' does not exist');
    }
    this._botsCompleteCallback[botname] = callback;
  }
}
