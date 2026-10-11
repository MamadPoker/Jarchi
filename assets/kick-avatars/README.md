# Kick default profile pictures

Kick's own pictures for users without a profile picture, unmodified, downloaded from kick.com:
`https://kick.com/img/default-profile-pictures/default-avatar-1.webp` … `default-avatar-6.webp`.

kick.com's web app picks one of these six in its `getProfilePicture` helper (`(id % 6) + 1`; where it has no user id it
shows number 2). Jarchi's chat widget picks one by the viewer's name instead (the same name always gets the same picture),
for Kick viewers without a picture or whose picture can't be looked up or loaded.

If Kick changes or adds pictures, look for `default-profile-pictures` in kick.com's scripts
(`https://assets.kick.com/main/_next/static/chunks/…`) and download them the same way.

These pictures belong to Kick and are only used to show what Kick shows for the same users.
