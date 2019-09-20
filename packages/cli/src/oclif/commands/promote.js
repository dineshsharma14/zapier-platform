const _ = require('lodash');
const colors = require('colors/safe');

const BaseCommand = require('../ZapierBaseCommand');
const { buildFlags } = require('../buildFlags');
const { callAPI, checkCredentials, getLinkedApp } = require('../../utils/api');
const { flattenCheckResult } = require('../../utils/display');
const { getVersionChangelog } = require('../../utils/changelog');

const serializeErrors = errors => {
  const opener = 'Promotion failed for the following reasons:\n\n';
  if (typeof errors[0] === 'string') {
    // errors is an array of strings
    return opener + errors.map(e => `* ${e}`).join('\n');
  }

  const issues = flattenCheckResult({ errors: errors });
  return (
    opener +
    issues
      .map(i => `* ${i.method}: ${i.description}\n ${colors.gray(i.link)}`)
      .join('\n')
  );
};

class PromoteCommand extends BaseCommand {
  async perform() {
    await checkCredentials();

    const version = this.args.version;

    let shouldContinue;
    const changelog = await getVersionChangelog(version);
    if (changelog) {
      this.log(colors.green(`Changelog found for ${version}`));
      this.log(`\n---\n${changelog}\n---\n`);

      shouldContinue = await this.confirm(
        'Would you like to continue promoting with this changelog?'
      );
    } else {
      this.log(
        `${colors.yellow(
          'Warning!'
        )} Changelog not found. Please create a CHANGELOG.md file in a format similar to ${colors.cyan(
          'https://gist.github.com/xavdid/b9ede3565f1188ce339292acc29612b2'
        )} with user-facing descriptions.`
      );

      shouldContinue = await this.confirm(
        'Would you like to continue promoting without a changelog?'
      );
    }

    if (!shouldContinue) {
      throw new Error('Cancelled promote.');
    }

    const app = await getLinkedApp();
    this.log(
      `Preparing to promote version ${version} of your app "${app.title}".`
    );

    const body = {};
    if (changelog) {
      body.changelog = changelog;
    }

    this.startSpinner(`Verifying and promoting ${version}`);

    const url = `/apps/${app.id}/versions/${version}/promote/production`;
    try {
      await callAPI(
        url,
        {
          method: 'PUT',
          body
        },
        true
      );
    } catch (response) {
      this.stopSpinner();

      const activationUrl = _.get(response, 'json.activationInfo.url');
      if (activationUrl) {
        this.log('\nGood news! Your app passes validation.');
        this.log(
          `The next step is to visit ${colors.cyan(
            activationUrl
          )} to request public activation of your app.`
        );
      } else {
        const errors = _.get(response, 'json.errors');
        if (!_.isEmpty(errors)) {
          throw new Error(serializeErrors(errors));
        } else if (response.errText) {
          throw new Error(response.errText);
        } else {
          // is an actual error
          throw response;
        }
      }

      return;
    }

    this.stopSpinner();
    this.log('  Promotion successful!');
    if (this.constructor.printMigrateHint) {
      this.log(
        'Optionally, run the `zapier migrate` command to move users to this version.'
      );
    }
  }
}

// Can be turn off when it's called by another command such as migrate
PromoteCommand.printMigrateHint = true;

PromoteCommand.flags = buildFlags();

PromoteCommand.args = [
  {
    name: 'version',
    required: true,
    description: 'The version you want promote.'
  }
];

PromoteCommand.examples = [
  'zapier promote 1.0.0',
  'zapier promote 2.0.0 --no-changelog'
];
PromoteCommand.description = `Promotes a specific version to public access.

Promotes an app version into production (non-private) rotation, which means new users can use this app version.

* This ${colors.bold(
  'does'
)} mark the version as the official public version - all other versions & users are grandfathered.
* This does ${colors.bold(
  'NOT'
)} build/upload or deploy a version to Zapier - you should \`zapier push\` first.
* This does ${colors.bold(
  'NOT'
)} move old users over to this version - \`zapier migrate 1.0.0 1.0.1\` does that.
* This does ${colors.bold(
  'NOT'
)} recommend old users stop using this version - \`zapier deprecate 1.0.0 2017-01-01\` does that.

Promotes are an inherently safe operation for all existing users of your app.

> If this is your first time promoting - this will start the platform quality assurance process by alerting the Zapier platform team of your intent to make your app public. We'll respond within a few business days.`;

module.exports = PromoteCommand;
