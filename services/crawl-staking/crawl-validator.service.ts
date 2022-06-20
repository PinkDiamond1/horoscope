/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';
import CallApiMixin from '../../mixins/callApi/call-api.mixin';
import { Service, ServiceBroker } from 'moleculer';
const QueueService = require('moleculer-bull');
import { dbValidatorMixin } from '../../mixins/dbMixinMongoose';
import { JsonConvert, OperationMode } from 'json2typescript';
import { Config } from '../../common';
import { URL_TYPE_CONSTANTS } from '../../common/constant';
import { ValidatorResponseFromApi } from '../../types';
import { Job } from 'bull';
import { ValidatorEntity } from '../../entities';

export default class CrawlValidatorService extends Service {
	private callApiMixin = new CallApiMixin().start();
	private dbValidatorMixin = dbValidatorMixin;

	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'crawlValidator',
			version: 1,
			mixins: [
				QueueService(`${Config.REDIS_URI}`, {
					prefix: 'crawl.staking.validator',
				}),
				this.callApiMixin,
				this.dbValidatorMixin,
			],
			queues: {
				'crawl.staking.validator': {
					concurrency: 1,
					async process(job: Job) {
						job.progress(10);
						// @ts-ignore
						await this.handleJob(job.data.url);
						job.progress(100);
						return true;
					},
				},
			},
		});
	}

	async handleJob(url: String) {
		let listValidator: ValidatorEntity[] = [];

		let urlToCall = url;
		let resultCallApi: ValidatorResponseFromApi;

		let done = false;

		while (!done) {
			resultCallApi = await this.callApi(URL_TYPE_CONSTANTS.LCD, urlToCall);

			listValidator.push(...resultCallApi.validators);
			if (resultCallApi.pagination.next_key === null) {
				done = true;
			} else {
				urlToCall = `${url}&pagination.key=${resultCallApi.pagination.next_key}`;
			}
		}

		this.logger.debug(`result: ${JSON.stringify(listValidator)}`);

		listValidator.map(async (validator) => {
			let foundValidator = await this.adapter.findOne({
				operator_address: `${validator.operator_address}`,
			});
			try {
				if (foundValidator) {
					let result = await this.adapter.updateById(foundValidator.id, validator);
				} else {
					const item: any = new JsonConvert().deserializeObject(
						validator,
						ValidatorEntity,
					);
					let id = await this.adapter.insert(item);
				}
			} catch (error) {
				this.logger.error(error);
			}
		});
	}

	async _start() {
		this.createJob(
			'crawl.staking.validator',
			{
				url: `${Config.GET_ALL_VALIDATOR}?pagination.limit=${Config.NUMBER_OF_VALIDATOR_PER_CALL}`,
			},
			{
				removeOnComplete: true,
				repeat: {
					every: parseInt(Config.MILISECOND_CRAWL_VALIDATOR, 10),
				},
			},
		);

		this.getQueue('crawl.staking.validator').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!, result: ${job.returnvalue}`);
		});
		this.getQueue('crawl.staking.validator').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!, error: ${job.stacktrace}`);
		});
		this.getQueue('crawl.staking.validator').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress: ${job.progress()}%`);
		});

		return super._start();
	}
}
