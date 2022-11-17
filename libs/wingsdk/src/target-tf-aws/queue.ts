import { LambdaEventSourceMapping } from "@cdktf/provider-aws/lib/lambda-event-source-mapping";
import { SqsQueue } from "@cdktf/provider-aws/lib/sqs-queue";
import { Construct, IConstruct } from "constructs";
import * as cloud from "../cloud";
import { QueueInflightMethods } from "../cloud";
import * as core from "../core";

import { Function } from "./function";

/**
 * AWS implementation of `cloud.Queue`.
 *
 * @inflight `@winglang/wingsdk.tfaws.IQueueClient`
 */
export class Queue extends cloud.QueueBase {
  private readonly queue: SqsQueue;
  constructor(scope: Construct, id: string, props: cloud.QueueProps = {}) {
    super(scope, id, props);

    this.queue = new SqsQueue(this, "Default", {
      visibilityTimeoutSeconds: props.timeout?.seconds,
    });

    if ((props.initialMessages ?? []).length) {
      throw new Error(
        "initialMessages not supported yet for AWS target - https://github.com/winglang/wing/issues/281"
      );
    }
  }

  public onMessage(
    inflight: core.Inflight,
    props: cloud.QueueOnMessageProps = {}
  ): cloud.Function {
    const code: string[] = [];
    code.push(inflight.code.text);
    code.push(`async function $sqsEventWrapper($cap, event) {`);
    code.push(`  for (const record of event.Records ?? []) {`);
    code.push(`    await ${inflight.entrypoint}($cap, record.body);`);
    code.push(`  }`);
    code.push(`}`);
    const newInflight = new core.Inflight({
      entrypoint: `$sqsEventWrapper`,
      code: core.NodeJsCode.fromInline(code.join("\n")),
    });

    const fn = new cloud.Function(
      this,
      `OnMessage-${newInflight.code.hash.slice(0, 16)}`,
      newInflight,
      props
    );

    // TODO: remove this constraint by adding generic permission APIs to cloud.Function
    if (!(fn instanceof Function)) {
      throw new Error("Queue only supports creating tfaws.Function right now");
    }

    fn.addPolicyStatements({
      effect: "Allow",
      action: [
        "sqs:ReceiveMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueUrl",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
      ],
      resource: this.queue.arn,
    });

    new LambdaEventSourceMapping(this, "EventSourceMapping", {
      functionName: fn._functionName,
      eventSourceArn: this.queue.arn,
      batchSize: props.batchSize ?? 1,
    });

    return fn;
  }

  /**
   * @internal
   */
  public _bind(
    captureScope: IConstruct,
    metadata: core.CaptureMetadata
  ): core.Code {
    if (!(captureScope instanceof Function)) {
      throw new Error("queues can only be captured by tfaws.Function for now");
    }

    const env = `QUEUE_URL__${this.node.id}`;

    const methods = new Set(metadata.methods ?? []);
    if (methods.has(QueueInflightMethods.PUSH)) {
      captureScope.addPolicyStatements({
        effect: "Allow",
        action: [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
        ],
        resource: this.queue.arn,
      });
    }

    // The queue url needs to be passed through an environment variable since
    // it may not be resolved until deployment time.
    captureScope.addEnvironment(env, this.queue.url);

    return core.InflightClient.for(__filename, "QueueClient", [
      `process.env["${env}"]`,
    ]);
  }
}

/**
 * AWS implementation of inflight client for `cloud.Queue`.
 */
export interface IQueueClient extends cloud.IQueueClient {}