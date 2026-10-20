// SPDX-FileCopyrightText: 2026 Authelia
//
// SPDX-License-Identifier: Apache-2.0

// authelia-plus: the user's active sessions, each of which they can revoke.

import { Fragment, useCallback, useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import { Button } from "@components/UI/Button";
import { Card, CardContent } from "@components/UI/Card";
import { Spinner } from "@components/UI/Spinner";
import { useNotifications } from "@contexts/NotificationsContext";
import { useSignOut } from "@hooks/SignOut";
import { useUserInfoGET } from "@hooks/UserInfo";
import { PlusSession, getPlusSessions, revokePlusSession } from "@services/PlusSessions";
import { UserSessionElevation, getUserSessionElevation } from "@services/UserSessionElevation";
import SecondFactorDialog from "@views/Settings/Common/SecondFactorDialog";
import SessionItem from "@views/Settings/Sessions/SessionItem";
import SessionRevokeDialog from "@views/Settings/Sessions/SessionRevokeDialog";

const SessionsView = function () {
    const { t: translate } = useTranslation("settings");
    const { createErrorNotification, createInfoNotification, createSuccessNotification } = useNotifications();
    const signOut = useSignOut();

    const [userInfo, fetchUserInfo, , fetchUserInfoError] = useUserInfoGET();
    const [sessions, setSessions] = useState<PlusSession[]>();
    const [secondFactor, setSecondFactor] = useState(false);
    const [elevation, setElevation] = useState<UserSessionElevation>();
    const [dialogSFOpening, setDialogSFOpening] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<PlusSession>();
    // The one revoke in flight, including while it waits on the second factor. Others are refused until it's done.
    const [revoking, setRevoking] = useState<PlusSession>();

    const handleRefresh = useCallback(() => {
        getPlusSessions()
            .then((result) => {
                setSecondFactor(result.secondFactor);
                setSessions(result.secondFactor ? undefined : result.sessions);
            })
            .catch((error) => {
                console.error(error);
                createErrorNotification(
                    translate("There was an issue retrieving the {{item}}", { item: translate("sessions") }),
                );
            });
    }, [createErrorNotification, translate]);

    useEffect(() => {
        fetchUserInfo();
        handleRefresh();
    }, [fetchUserInfo, handleRefresh]);

    useEffect(() => {
        if (fetchUserInfoError) {
            createErrorNotification(
                translate("There was an issue retrieving the {{item}}", { item: translate("user preferences") }),
            );
        }
    }, [fetchUserInfoError, createErrorNotification, translate]);

    // The same second factor dialog the credential settings use, held to a second factor: the session endpoints need
    // the session's authentication level raised, which an emailed one-time code doesn't do.
    const handleSecondFactor = () => {
        getUserSessionElevation()
            .then((result) => {
                if (!result) {
                    throw new Error("The session elevation status was empty");
                }

                setElevation({
                    ...result,
                    can_skip_second_factor: false,
                    require_second_factor: true,
                    skip_second_factor: false,
                });
                setDialogSFOpening(true);
            })
            .catch((error) => {
                console.error(error);
                setRevoking(undefined);
                createErrorNotification(translate("Failed to get session elevation status"));
            });
    };

    const handleRevoke = (session: PlusSession) => {
        setRevoking(session);

        revokePlusSession(session.id)
            .then((result) => {
                if (result === "second_factor") {
                    handleSecondFactor();

                    return;
                }

                setRevoking(undefined);

                if (result === "not_found") {
                    createInfoNotification(translate("This session has already ended"));
                } else if (session.current) {
                    signOut(false);

                    return;
                } else {
                    createSuccessNotification(
                        translate("Successfully {{action}} the {{item}}", {
                            action: translate("revoked"),
                            item: translate("session"),
                        }),
                    );
                }

                handleRefresh();
            })
            .catch((error) => {
                console.error(error);
                setRevoking(undefined);
                createErrorNotification(
                    translate("There was a problem {{action}} the {{item}}", {
                        action: translate("revoking"),
                        item: translate("session"),
                    }),
                );
            });
    };

    const handleSFDialogClosed = (ok: boolean, changed: boolean) => {
        const session = revoking;

        setElevation(undefined);
        setRevoking(undefined);

        if (!ok || !changed) {
            return;
        }

        if (session) {
            handleRevoke(session);
        } else {
            handleRefresh();
        }
    };

    const handleRevokeConfirm = () => {
        const session = revokeTarget;

        setRevokeTarget(undefined);

        if (session && !revoking) {
            handleRevoke(session);
        }
    };

    const renderSessions = () => {
        if (secondFactor) {
            return (
                <div className="flex flex-col items-start gap-2">
                    <p className="text-sm">
                        {translate("You must authenticate with your second factor to view your sessions")}
                    </p>
                    <Button
                        id={"sessions-second-factor"}
                        variant={"outline"}
                        color={"primary"}
                        onClick={handleSecondFactor}
                    >
                        {translate("Authenticate")}
                    </Button>
                </div>
            );
        }

        if (sessions === undefined) {
            return <Spinner size={20} />;
        }

        if (sessions.length === 0) {
            return <p className="text-sm text-muted-foreground">{translate("There are no active sessions")}</p>;
        }

        return (
            <div className="flex flex-col gap-2">
                {sessions.map((session) => (
                    <SessionItem
                        key={session.id}
                        session={session}
                        disabled={revoking !== undefined}
                        handleRevoke={() => {
                            setRevokeTarget(session);
                        }}
                    />
                ))}
            </div>
        );
    };

    return (
        <Fragment>
            <SecondFactorDialog
                info={userInfo}
                elevation={elevation}
                opening={dialogSFOpening}
                handleClosed={handleSFDialogClosed}
                handleOpened={() => {
                    setDialogSFOpening(false);
                }}
            />
            <SessionRevokeDialog
                session={revokeTarget}
                onConfirm={handleRevokeConfirm}
                onCancel={() => {
                    setRevokeTarget(undefined);
                }}
            />
            <div className="grid grid-cols-1 gap-4">
                <div className="w-full">
                    <Card
                        id={"sessions-panel"}
                        className="py-2"
                        data-loading={!secondFactor && sessions === undefined ? "true" : "false"}
                    >
                        <CardContent className="grid grid-cols-12 gap-4 p-4">
                            <div className="col-span-12">
                                <h5 className="text-xl font-semibold">{translate("Sessions")}</h5>
                                <p className="text-sm text-muted-foreground">
                                    {translate(
                                        "These are the devices signed in to your account, revoke any you don't recognize",
                                    )}
                                </p>
                            </div>
                            <div className="col-span-12">{renderSessions()}</div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </Fragment>
    );
};

export default SessionsView;
