/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';
import { Config } from '../../common';
import { Service, Context, ServiceBroker } from 'moleculer';

const QueueService = require('moleculer-bull');
import { Job } from 'bull';
import { dbTransactionMixin } from '../../mixins/dbMixinMongoose';
import RedisMixin from '../../mixins/redis/redis.mixin';
export default class IndexTxService extends Service {
	private redisMixin = new RedisMixin().start();
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'indextx',
			version: 1,
			mixins: [
				QueueService(
					`redis://${Config.REDIS_USERNAME}:${Config.REDIS_PASSWORD}@${Config.REDIS_HOST}:${Config.REDIS_PORT}/${Config.REDIS_DB_NUMBER}`,
					{
						prefix: 'index.tx',
					},
				),
				dbTransactionMixin,
				this.redisMixin,
			],
			queues: {
				'index.tx': {
					concurrency: 10,
					async process(job: Job) {
						job.progress(10);
						// @ts-ignore
						await this.handleJob(job.data.lastId);
						job.progress(100);
						return true;
					},
				},
			},
		});
	}

	async handleJob(lastId: string) {
		let listTx = await this.adapter.find({
			query: {
				'custom_info.chain_id': 'euphoria-1',
				'indexes.height': { $type: 'string' },
			},
			limit: 500,
			sort: '-indexes.height',
		});
		// let listTx = await this.adapter.find({
		// 	query: { 'indexes.message_action': { $regex: /[_]/g } },
		// 	limit: 5000,
		// });
		this.logger.info(1);
		let bulkOps: any[] = [];
		listTx.forEach(async (tx: any) => {
			this.logger.info(tx._id.toString());
			let indexes: any = {};
			indexes['timestamp'] = tx.tx_response.timestamp;
			indexes['height'] = tx.tx_response.height;
			// const actions = tx.indexes.message_action;
			// let newActions = actions.map((action: string) => {
			// 	return action.replace(/\_/g, '.');
			// });

			bulkOps.push({
				updateOne: {
					filter: { _id: tx._id },
					update: {
						$set: {
							'indexes.timestamp': indexes['timestamp'],
							'indexes.height': indexes['height'],
						},
					},
				},
			});
			if (bulkOps.length === 500) {
				let result = await this.adapter.bulkWrite(bulkOps);
				this.logger.info(result);
				this.logger.info('done 500');
				bulkOps = [];
			}
		});
		if (bulkOps.length > 0) {
			let result = await this.adapter.bulkWrite(bulkOps);
			this.logger.info(result);
		}
		this.logger.info('done');
	}

	async _start() {
		// let operatorAddress = 'cosmosvaloper1c4k24jzduc365kywrsvf5ujz4ya6mwympnc4en';
		// const operator_address = data.operator_address;
		// const decodeAcc = bech32.decode(operatorAddress);
		// const wordsByte = bech32.fromWords(decodeAcc.words);
		// const account_address = bech32.encode('cosmos', bech32.toWords(wordsByte));

		// const operator_address = operatorAddress;
		// const decodeAcc = bech32.decode(operator_address.toString());
		// const wordsByte = bech32.fromWords(decodeAcc.words);
		// const account_address = bech32.encode('cosmos', bech32.toWords(wordsByte));
		// this.logger.info('account_address:', account_address);
		// this.redisClient = await this.getRedisClient();
		this.createJob(
			'index.tx',
			{
				lastId: '0',
			},
			{
				removeOnComplete: true,
			},
		);

		this.getQueue('index.tx').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!, result: ${job.returnvalue}`);
		});
		this.getQueue('index.tx').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!, error: ${job.failedReason}`);
		});
		this.getQueue('index.tx').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress: ${job.progress()}%`);
		});
		return super._start();
	}
}
