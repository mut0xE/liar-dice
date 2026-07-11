/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/liar_dice.json`.
 */
export type LiarDice = {
  "address": "4Q9UvCjAeKP8xRBLNoSx3ZCp4vmrGXpKcZ1td3RRbzMN",
  "metadata": {
    "name": "liarDice",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "beginBidding",
      "docs": [
        "Close the shared roll window and open bidding (permissionless; active hands via remaining_accounts)."
      ],
      "discriminator": [
        147,
        210,
        60,
        129,
        222,
        109,
        104,
        139
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Any signer may open bidding — a plain wallet or a player's session key."
          ],
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "Shared game state; the round phase + participation are decided here.",
            "(Active player hands come in via `remaining_accounts`.)"
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "cancelGame",
      "discriminator": [
        121,
        194,
        154,
        118,
        103,
        235,
        149,
        52
      ],
      "accounts": [
        {
          "name": "host",
          "docs": [
            "Only the host may cancel their own game (enforced by `has_one`)."
          ],
          "signer": true,
          "relations": [
            "game"
          ]
        },
        {
          "name": "game",
          "docs": [
            "The game to cancel. Must still be in `Waiting`."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "The game's vault PDA that entry fees are refunded from."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "challenge",
      "discriminator": [
        16,
        107,
        14,
        39,
        244,
        150,
        81,
        187
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The tx signer: the player's wallet OR an authorized session key."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The seat owner (real wallet) calling \"Liar!\". Not a signer."
          ]
        },
        {
          "name": "sessionToken",
          "docs": [
            "Optional session token proving `signer` may act for `authority`."
          ],
          "optional": true
        },
        {
          "name": "game",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeHand",
      "docs": [
        "Reclaim a hand's rent after the game has ended + undelegated"
      ],
      "discriminator": [
        141,
        194,
        30,
        18,
        120,
        106,
        203,
        202
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Anyone may trigger cleanup; they don't receive the rent."
          ],
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "The finished game (must be `Ended` and undelegated back to base)."
          ],
          "relations": [
            "playerHand"
          ]
        },
        {
          "name": "player",
          "docs": [
            "The rent recipient — must be the hand's owner (enforced by `has_one` below)."
          ],
          "writable": true,
          "relations": [
            "playerHand"
          ]
        },
        {
          "name": "playerHand",
          "docs": [
            "The hand to close; rent goes to `player`. Seeds + `has_one` tie it to (game, player)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "consumeRoll",
      "docs": [
        "VRF callback that writes the rolled dice. Only the VRF program may call it."
      ],
      "discriminator": [
        72,
        170,
        70,
        253,
        92,
        234,
        18,
        1
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "playerHand",
          "docs": [
            "The hand whose dice are being written (passed via the request's callback metas)."
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "createGame",
      "discriminator": [
        124,
        69,
        75,
        66,
        184,
        220,
        72,
        206
      ],
      "accounts": [
        {
          "name": "host",
          "docs": [
            "The player creating the table. Pays rent for the game account."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "The game state account, a PDA unique to (host, game_id)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "host"
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        },
        {
          "name": "entryFee",
          "type": "u64"
        },
        {
          "name": "timeoutGrace",
          "type": "i64"
        }
      ]
    },
    {
      "name": "delegateGame",
      "docs": [
        "Delegate the shared game PDA to the ER (host-only, in the start tx)."
      ],
      "discriminator": [
        116,
        183,
        70,
        107,
        112,
        223,
        122,
        210
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Whoever pays for the delegation (the host, in the start_game tx)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "host"
        },
        {
          "name": "bufferGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                50,
                129,
                2,
                94,
                236,
                28,
                86,
                255,
                214,
                19,
                250,
                231,
                240,
                215,
                20,
                31,
                196,
                5,
                32,
                39,
                7,
                65,
                178,
                120,
                104,
                201,
                103,
                180,
                81,
                64,
                60,
                241
              ]
            }
          }
        },
        {
          "name": "delegationRecordGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "host"
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "validator",
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "4Q9UvCjAeKP8xRBLNoSx3ZCp4vmrGXpKcZ1td3RRbzMN"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "delegateHand",
      "docs": [
        "Delegate the caller's own hand to the ER (once per player, in the join tx)."
      ],
      "discriminator": [
        67,
        78,
        31,
        57,
        218,
        26,
        110,
        74
      ],
      "accounts": [
        {
          "name": "player",
          "docs": [
            "The joining player; signs the delegation of their own hand."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "host"
        },
        {
          "name": "game",
          "docs": [
            "derive the hand seeds. NOT delegated by this instruction."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "host"
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "bufferPlayerHand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "playerHand"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                50,
                129,
                2,
                94,
                236,
                28,
                86,
                255,
                214,
                19,
                250,
                231,
                240,
                215,
                20,
                31,
                196,
                5,
                32,
                39,
                7,
                65,
                178,
                120,
                104,
                201,
                103,
                180,
                81,
                64,
                60,
                241
              ]
            }
          }
        },
        {
          "name": "delegationRecordPlayerHand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "playerHand"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPlayerHand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "playerHand"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "playerHand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "validator",
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "4Q9UvCjAeKP8xRBLNoSx3ZCp4vmrGXpKcZ1td3RRbzMN"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "endGame",
      "docs": [
        "End the game on the ER: commit + undelegate the `Game` and pay out atomically via a post-commit Magic Action."
      ],
      "discriminator": [
        224,
        135,
        245,
        99,
        67,
        175,
        121,
        252
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Anyone may trigger this; also the ER payer and escrow authority for the `payout` action."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "The finished game, delegated on the ER. Committed + undelegated here."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "lamport transfer happens in the base-layer `payout` action). Not `mut`:",
            "it's a non-delegated base-layer account, so marking it writable on the ER",
            "would trip `InvalidWritableAccount`."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "winner"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "forceTimeout",
      "docs": [
        "Permissionless liveness escape hatch: evict the player who has stalled past the deadline."
      ],
      "discriminator": [
        223,
        41,
        225,
        244,
        115,
        43,
        255,
        74
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The tx signer: any wallet, OR an authorized session key for `authority`."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "Whoever the trigger is attributed to. Not a signer."
          ]
        },
        {
          "name": "sessionToken",
          "docs": [
            "Optional session token proving `signer` may act for `authority`."
          ],
          "optional": true
        },
        {
          "name": "game",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "target",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initHandPermission",
      "docs": [
        "Make the caller's hand private on the ER (once per player, right after delegate)."
      ],
      "discriminator": [
        185,
        166,
        70,
        167,
        58,
        78,
        233,
        228
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The tx signer: the player's wallet OR a session key for `authority`."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The seat owner (real wallet), not a signer. Used for the hand seeds and as the",
            "permission member."
          ]
        },
        {
          "name": "sessionToken",
          "docs": [
            "Optional session token proving `signer` may act for `authority`."
          ],
          "optional": true
        },
        {
          "name": "playerHand",
          "docs": [
            "The caller's own hand (delegated → owned by this program again on the ER).",
            "Seeds tie it to `authority`, so no one can init another player's permission."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "player_hand.game",
                "account": "playerHand"
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "permission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "playerHand"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinGame",
      "discriminator": [
        107,
        112,
        18,
        38,
        56,
        173,
        60,
        128
      ],
      "accounts": [
        {
          "name": "player",
          "docs": [
            "The player joining. Pays the entry fee and rent for their hand account."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "The game being joined."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "The game's vault PDA that holds the prize pot. Entry fees are sent here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "playerHand",
          "docs": [
            "This player's private dice, a PDA unique to (game, player)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "payout",
      "docs": [
        "Post-commit Magic Action target: pays the whole pot to the winner on base layer (not called directly)."
      ],
      "discriminator": [
        149,
        140,
        194,
        236,
        174,
        189,
        6,
        239
      ],
      "accounts": [
        {
          "name": "game",
          "docs": [
            "the handler (`GAME_SEED` derivation + `Game::try_deserialize` + status/winner checks)."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "winner",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow"
        }
      ],
      "args": []
    },
    {
      "name": "placeBid",
      "discriminator": [
        238,
        77,
        148,
        91,
        200,
        151,
        92,
        146
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The tx signer: the player's wallet OR a session key for `authority`."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The seat owner (real wallet), not a signer. Used for the seat lookup and hand seeds."
          ]
        },
        {
          "name": "sessionToken",
          "docs": [
            "Optional session token proving `signer` may act for `authority`."
          ],
          "optional": true
        },
        {
          "name": "game",
          "docs": [
            "Shared game state: the standing bid and turn cursor (mutated here)."
          ],
          "writable": true
        },
        {
          "name": "playerHand",
          "docs": [
            "The seat owner's own hand, read only for the `rolled` check (seeds tie it to authority)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "quantity",
          "type": "u16"
        },
        {
          "name": "face",
          "type": "u8"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer"
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "requestRoll",
      "docs": [
        "Request a provably-fair dice roll from the VRF oracle (on the ER)."
      ],
      "discriminator": [
        98,
        118,
        98,
        29,
        96,
        208,
        255,
        97
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "Whoever signs and pays for the VRF request: the player's real wallet OR an",
            "ephemeral session key authorized for `authority`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The seat owner (real wallet) whose hand is rolled. Not a signer."
          ]
        },
        {
          "name": "sessionToken",
          "docs": [
            "Optional session token proving `signer` may act for `authority`."
          ],
          "optional": true
        },
        {
          "name": "game",
          "writable": true,
          "relations": [
            "playerHand"
          ]
        },
        {
          "name": "playerHand",
          "docs": [
            "The seat owner's hand; the oracle callback writes dice into it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": "u8"
        }
      ]
    },
    {
      "name": "reveal",
      "docs": [
        "Publish your own hand after a challenge (each active player calls once)."
      ],
      "discriminator": [
        9,
        35,
        59,
        190,
        167,
        249,
        76,
        115
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The tx signer: the player's wallet OR an authorized session key."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The seat owner (real wallet) whose hand is being revealed. Not a signer."
          ]
        },
        {
          "name": "sessionToken",
          "docs": [
            "Optional session token proving `signer` may act for `authority`."
          ],
          "optional": true
        },
        {
          "name": "game",
          "writable": true,
          "relations": [
            "playerHand"
          ]
        },
        {
          "name": "playerHand",
          "docs": [
            "The seat owner's own hand; seeds + `has_one` ensure only `authority`'s dice can be revealed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "settleRound",
      "discriminator": [
        40,
        101,
        18,
        1,
        31,
        129,
        52,
        77
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The tx signer: any wallet OR an authorized session key."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The seat owner (real wallet) the signer acts for. Not a signer."
          ]
        },
        {
          "name": "sessionToken",
          "docs": [
            "Optional session token proving `signer` may act for `authority`."
          ],
          "optional": true
        },
        {
          "name": "game",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "startGame",
      "discriminator": [
        249,
        47,
        252,
        172,
        184,
        162,
        245,
        14
      ],
      "accounts": [
        {
          "name": "host",
          "docs": [
            "Only the host who created the table may start it."
          ],
          "signer": true,
          "relations": [
            "game"
          ]
        },
        {
          "name": "game",
          "docs": [
            "The game being started; `has_one` ties it to the host."
          ],
          "writable": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "game",
      "discriminator": [
        27,
        90,
        166,
        125,
        74,
        100,
        121,
        18
      ]
    },
    {
      "name": "playerHand",
      "discriminator": [
        16,
        240,
        39,
        61,
        10,
        73,
        250,
        160
      ]
    },
    {
      "name": "sessionTokenV2",
      "discriminator": [
        178,
        3,
        85,
        254,
        13,
        116,
        128,
        41
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notYourTurn",
      "msg": "Not your turn"
    },
    {
      "code": 6001,
      "name": "badGameState",
      "msg": "Game not in the required state"
    },
    {
      "code": 6002,
      "name": "invalidFace",
      "msg": "Bid face must be 1..=6"
    },
    {
      "code": 6003,
      "name": "invalidQuantity",
      "msg": "Bid quantity must be >= 1"
    },
    {
      "code": 6004,
      "name": "bidTooLarge",
      "msg": "Bid exceeds total dice in play"
    },
    {
      "code": 6005,
      "name": "bidNotHigher",
      "msg": "Bid must be strictly higher"
    },
    {
      "code": 6006,
      "name": "nothingToChallenge",
      "msg": "No current bid to challenge"
    },
    {
      "code": 6007,
      "name": "notRolled",
      "msg": "Dice not rolled yet"
    },
    {
      "code": 6008,
      "name": "tableFull",
      "msg": "Table is full"
    },
    {
      "code": 6009,
      "name": "notEnoughPlayers",
      "msg": "Need at least 2 players"
    },
    {
      "code": 6010,
      "name": "eliminated",
      "msg": "Player already eliminated"
    },
    {
      "code": 6011,
      "name": "alreadyJoined",
      "msg": "Player already joined this game"
    },
    {
      "code": 6012,
      "name": "badPayment",
      "msg": "Incorrect payment amount"
    },
    {
      "code": 6013,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6014,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6015,
      "name": "missingHand",
      "msg": "A required player hand was not provided"
    },
    {
      "code": 6016,
      "name": "duplicateHand",
      "msg": "Duplicate hand provided"
    },
    {
      "code": 6017,
      "name": "noWinner",
      "msg": "Game does not have a single winner yet"
    },
    {
      "code": 6018,
      "name": "notSettled",
      "msg": "No settled round to process"
    },
    {
      "code": 6019,
      "name": "alreadyRolled",
      "msg": "Dice already rolled for this round"
    },
    {
      "code": 6020,
      "name": "invalidTimeout",
      "msg": "Timeout grace must be > 0"
    },
    {
      "code": 6021,
      "name": "deadlineNotReached",
      "msg": "The action deadline has not passed yet"
    },
    {
      "code": 6022,
      "name": "notStalling",
      "msg": "Target player is not the one holding up the game"
    }
  ],
  "types": [
    {
      "name": "bid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "quantity",
            "type": "u16"
          },
          {
            "name": "face",
            "type": "u8"
          },
          {
            "name": "bidder",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "game",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "host",
            "type": "pubkey"
          },
          {
            "name": "gameId",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "gameStatus"
              }
            }
          },
          {
            "name": "players",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "diceCounts",
            "type": "bytes"
          },
          {
            "name": "isActive",
            "type": {
              "vec": "bool"
            }
          },
          {
            "name": "currentTurn",
            "type": "u8"
          },
          {
            "name": "round",
            "type": "u16"
          },
          {
            "name": "currentBid",
            "type": {
              "option": {
                "defined": {
                  "name": "bid"
                }
              }
            }
          },
          {
            "name": "lastLoser",
            "type": "u8"
          },
          {
            "name": "challenger",
            "docs": [
              "Seat index of the player who called \"Liar!\" on the current bid."
            ],
            "type": "u8"
          },
          {
            "name": "lastReveal",
            "docs": [
              "Each active player's dice for the challenged round, filled by their own `reveal` call."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "reveal"
                }
              }
            }
          },
          {
            "name": "entryFeeLamports",
            "docs": [
              "The buy-in each player pays once on join."
            ],
            "type": "u64"
          },
          {
            "name": "potLamports",
            "docs": [
              "The prize pot: running total of all entry fees held in the vault."
            ],
            "type": "u64"
          },
          {
            "name": "phase",
            "docs": [
              "Where the current round is: Rolling -> Bidding -> Revealing (see `RoundPhase`)."
            ],
            "type": {
              "defined": {
                "name": "roundPhase"
              }
            }
          },
          {
            "name": "participating",
            "docs": [
              "Who actually rolled for THIS round (set by `begin_bidding`); only these seats",
              "bid/reveal/get counted. A skipped (non-rolling) player stays `is_active` but sits out."
            ],
            "type": {
              "vec": "bool"
            }
          },
          {
            "name": "missedRolls",
            "docs": [
              "Consecutive rolling phases each seat has missed; reset on a good roll, eliminated at `MISS_LIMIT`."
            ],
            "type": "bytes"
          },
          {
            "name": "timeoutGrace",
            "docs": [
              "Seconds a player is given to make the pending move before anyone may `force_timeout` them.",
              "Set once at `create_game`; a real table might use 60-120s."
            ],
            "type": "i64"
          },
          {
            "name": "actionDeadline",
            "docs": [
              "Unix timestamp by which the currently-owed action must happen, else `force_timeout` can fire.",
              "0 means nothing is pending (game not started, or ended)."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "gameStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "waiting"
          },
          {
            "name": "active"
          },
          {
            "name": "ended"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "playerHand",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "game",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "dice",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "diceCount",
            "type": "u8"
          },
          {
            "name": "rolled",
            "type": "bool"
          },
          {
            "name": "revealed",
            "type": "bool"
          },
          {
            "name": "rolledRound",
            "docs": [
              "The `Game.round` these dice were rolled for, so `request_roll` allows only one roll per round."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "reveal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "playerIdx",
            "type": "u8"
          },
          {
            "name": "dice",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "diceCount",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roundPhase",
      "docs": [
        "Where an Active round is in its lifecycle:",
        "Rolling   — everyone rolls simultaneously (one shared roll window).",
        "Bidding   — turn-based bidding/challenging over the players who rolled.",
        "Revealing — a challenge is open; participants reveal, then `settle_round` scores it."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "rolling"
          },
          {
            "name": "bidding"
          },
          {
            "name": "revealing"
          }
        ]
      }
    },
    {
      "name": "sessionTokenV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "type": "pubkey"
          },
          {
            "name": "sessionSigner",
            "type": "pubkey"
          },
          {
            "name": "feePayer",
            "type": "pubkey"
          },
          {
            "name": "validUntil",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
