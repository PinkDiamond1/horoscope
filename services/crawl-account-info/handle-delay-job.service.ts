/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';

import { dbDelayJobMixin } from "@Mixins/dbMixinMongoose/db-delay-job.mixin";
import { Job } from "bull";
import { Config } from "common";
import { DELAY_JOB_TYPE } from "common/constant";
import { RedelegateEntry } from "entities";
import { DelayJobEntity } from "entities/delay-job.entity";
import { indexOf } from "lodash";
import { Service, ServiceBroker } from "moleculer";
const QueueService = require('moleculer-bull');
const mongo = require('mongodb');

export default class HandleDelayJobService extends Service {
    private dbDelayJobMixin = dbDelayJobMixin;

    public constructor(public broker: ServiceBroker) {
        super(broker);
        this.parseServiceSchema({
            name: 'handleDelayJob',
            version: 1,
            mixins: [
                QueueService(
                    `redis://${Config.REDIS_USERNAME}:${Config.REDIS_PASSWORD}@${Config.REDIS_HOST}:${Config.REDIS_PORT}/${Config.REDIS_DB_NUMBER}`,
                    {
                        prefix: 'handle.delay-job',
                    },
                ),
                this.dbDelayJobMixin,
            ],
            queues: {
                'handle.delay-job': {
                    concurrency: 1,
                    async process(job: Job) {
                        job.progress(10);
                        // @ts-ignore
                        await this.handleJob();
                        job.progress(100);
                        return true;
                    },
                },
            },
        });
    }

    async handleJob() {
        let listUpdateQueries: any[] = [];
        
        let client = await this.connectToDB();
		const db = client.db('aura_indexer_dev');
		let [accountBalances, accountSpendableBalances, accountRedelegates, accountUnbonds, delayJob] = await Promise.all([
            db.collection("account_balances"),
            db.collection("account_spendable_balances"),
            db.collection("account_redelegations"),
			db.collection("account_unbonds"),
			db.collection("delay_job"),
		]);

        let currentJobs: DelayJobEntity[] = await delayJob.find({ 'custom_info.chain_id': Config.CHAIN_ID }).toArray();
        currentJobs.map(async (job: any) => {
            if (job.expire_time <= new Date().getTime()) {
                switch(job.type) {
                    case DELAY_JOB_TYPE.REDELEGATE: 
                        let updateRedelegates = await accountRedelegates.find({
                                address: job.address,
                                'custom_info.chain_id': Config.CHAIN_ID
                            }).toArray();
                        let newRedelegates = updateRedelegates[0].redelegation_responses.entries,
                            removeRedelegate = newRedelegates
                                .filter((x: RedelegateEntry) => x.redelegation_entry.completion_time === job.expire_time)[0];
                        newRedelegates.splice(indexOf(removeRedelegate, 1));
                        listUpdateQueries.push(
                            accountRedelegates.updateOne(
                                {
                                    _id: updateRedelegates._id
                                },
                                {
                                    $set: {
                                        entries: newRedelegates
                                    }
                                }
                            ),
                        );
                    case DELAY_JOB_TYPE.UNBOND:
                        let [updateBalances, updateSpendableBalances, updateUnbonds] = await Promise.all([
                            accountBalances.find({
                                address: job.address,
                                'custom_info.chain_id': Config.CHAIN_ID
                            }).toArray(),
                            accountSpendableBalances.find({
                                address: job.address,
                                'custom_info.chain_id': Config.CHAIN_ID
                            }).toArray(),
                            accountUnbonds.find({
                                address: job.address,
                                'custom_info.chain_id': Config.CHAIN_ID
                            }).toArray(),
                        ]);
                        let newBalances = updateBalances[0].balances,
                            newSpendableBalances = updateSpendableBalances[0].spendable_balances,
                            newUnbonds = updateUnbonds[0].unbonding_responses.entries,
                            removeUnbond = newUnbonds
                                .filter((x: RedelegateEntry) => x.redelegation_entry.completion_time === job.expire_time)[0];
                        newBalances[0].amount += removeUnbond.balance;
                        newSpendableBalances[0].amount += removeUnbond.balance;
                        newUnbonds.splice(indexOf(removeUnbond, 1));
                        listUpdateQueries.push(...[
                            accountBalances.updateOne(
                                {
                                    _id: updateBalances._id
                                },
                                {
                                    $set: {
                                        balances: newBalances
                                    }
                                }
                            ),
                            accountSpendableBalances.updateOne(
                                {
                                    _id: updateSpendableBalances._id
                                },
                                {
                                    $set: {
                                        spendable_balances: newSpendableBalances
                                    }
                                }
                            ),
                            accountUnbonds.updateOne(
                                {
                                    _id: updateUnbonds._id
                                },
                                {
                                    $set: {
                                        entries: newUnbonds
                                    }
                                }
                            ),
                        ]);
                }
                const result = await Promise.all(listUpdateQueries);
                this.logger.info(result);
            }
        })
    }

    async connectToDB() {
		const DB_URL = `mongodb://${Config.DB_GENERIC_USER}:${encodeURIComponent(Config.DB_GENERIC_PASSWORD)}@${Config.DB_GENERIC_HOST}:${Config.DB_GENERIC_PORT}`;

		let cacheClient = await mongo.MongoClient.connect(
			DB_URL,
		);
		return cacheClient;
	}

    async _start() {
        this.createJob(
            'handle.delay-job',
            {
                removeOnComplete: true,
                repeat: {
                    every: parseInt(Config.MILISECOND_HANDLE_DELAY_JOB, 10),
                },
            },
        );

        this.getQueue('handle.delay-job').on('completed', (job: Job) => {
            this.logger.info(`Job #${job.id} completed!, result: ${job.returnvalue}`);
        });
        this.getQueue('handle.delay-job').on('failed', (job: Job) => {
            this.logger.error(`Job #${job.id} failed!, error: ${job.stacktrace}`);
        });
        this.getQueue('handle.delay-job').on('progress', (job: Job) => {
            this.logger.info(`Job #${job.id} progress: ${job.progress()}%`);
        });

        return super._start();
    }
}