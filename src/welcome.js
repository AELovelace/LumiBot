const { config } = require('./config');
const { logger } = require('./logger');
const { requestLlmCompletion } = require('./llmClient');
const { getSetting } = require('./panelSettings');

const INTRO_VIDEO_URL =
  'https://cdn.discordapp.com/attachments/959117873702395974/1439780356751364147/dollcord_intro.mp4?ex=69bc9a72&is=69bb48f2&hm=a4a66e3eb8321afa96b71c412d551b9c23c3d36e7601aefa6083c59d1341c927&';

let WELCOME_CHANNEL_ID = config.welcomeChannelId || '';
let INTRODUCTIONS_CHANNEL_ID = config.introductionsChannelId || '';

function reloadSettings() {
  try {
    WELCOME_CHANNEL_ID = String(getSetting('runtime.welcomeChannelId') || '').trim() || config.welcomeChannelId || '';
    INTRODUCTIONS_CHANNEL_ID = String(getSetting('runtime.introductionsChannelId') || '').trim() || config.introductionsChannelId || '';
  } catch {
    WELCOME_CHANNEL_ID = config.welcomeChannelId || '';
    INTRODUCTIONS_CHANNEL_ID = config.introductionsChannelId || '';
  }
}

reloadSettings();

async function generateWelcomeMessage(member) {
  const username = member.user.username;
  const displayName = member.displayName || username;
  const introMention = INTRODUCTIONS_CHANNEL_ID
    ? `<#${INTRODUCTIONS_CHANNEL_ID}>`
    : '#introductions';

  const prompt =
    `A new person named "${displayName}" (username: @${username}) just joined the Discord server. ` +
    `Write a short, warm, personalized welcome message addressed to them by tagging <@${member.id}>. ` +
    `Encourage them to post a little intro about themselves in ${introMention}. ` +
    `Keep it friendly, fun, and in your normal personality. No extra commentary — just the welcome message.`;

  try {
    const response = await requestLlmCompletion({
      latestContent: prompt,
      history: [],
      memoryClues: [],
      deepRecall: false,
      maxResponseChars: 500,
    });

    return response.trim();
  } catch (error) {
    logger.warn('Failed to generate AI welcome message, using fallback.', error.message);
    return (
      `Hey <@${member.id}>, welcome to the server! 🎉 ` +
      `We'd love to get to know you — drop a little intro in ${introMention} and say hi!`
    );
  }
}

async function handleGuildMemberAdd(member) {
  if (!WELCOME_CHANNEL_ID) {
    return;
  }

  try {
    const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      logger.warn(
        `Welcome channel ${WELCOME_CHANNEL_ID} not found or is not text-based.`,
      );
      return;
    }

    const welcomeText = await generateWelcomeMessage(member);

    await channel.send({
      content: `${welcomeText}\n\n${INTRO_VIDEO_URL}`,
    });

    logger.info(
      `Sent welcome message for ${member.user.tag} in channel ${WELCOME_CHANNEL_ID}.`,
    );
  } catch (error) {
    logger.error('Failed to send welcome message.', error.message);
  }
}

module.exports = { handleGuildMemberAdd, reloadSettings };
