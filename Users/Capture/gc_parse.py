# -*- coding: utf-8 -*-
"""
Libarary for parsing GC files from manual samplings
"""
import sys
import os
import glob
import numpy as np
import pandas as pd
from os import walk, chdir, getcwd, stat
import tkinter as TK
from tkinter import filedialog
from tkinter import messagebox
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
from time import time
from datetime import datetime
import matplotlib.pyplot as plt
import datetime as DT
from collections import defaultdict

sys.path.append(os.path.realpath(os.path.join(os.getcwd(), '../../prog')))
from regression import *
import find_regressions
import bisect_find
import utils
import resdir
import csv


def make_calibration_array(ref_gas_calibration=None):
    if ref_gas_calibration is None:
        ref_gas_calibration = {'OL': {'CO2': 361., 'CH4': 1.89, 'N2O': 0.585, 'SF6': None, 'H2': None,"luft":1.},  # Old Low
                               'OH': {'CO2': 10000., 'CH4': 10000., 'N2O': 151., 'SF6': None, 'H2': None,"luft":1.},  # Old High
                               'NL': {'CO2': 400., 'CH4': 2.00, 'N2O': 0.500, 'SF6': 0.05, 'H2': None,"luft":1.},  # New Low
                               'NH': {'CO2': 2000., 'CH4': 100., 'N2O': 10., 'SF6': None, 'H2': None,"luft":1.},  # New High
                               'LA': {'CO2': 400., 'CH4': 0., 'N2O': 0., 'SF6': 0., 'H2': 0.,"luft":1.}
                               }
    ref_gas_values = {}

    for key in ref_gas_calibration.keys():
        ref_gas_values[key] = {}
        for gas in ref_gas_calibration[key]:
            ref_gas_values[key][gas] = {
                "ref_gas_ppm": ref_gas_calibration[key][gas],
                "gc_tick_mean": None,
                "gc_tick_std": None,
                "gc_ppm_mean": None,
            }

    return ref_gas_values


def get_ref_gas_Values(df, ref_gas_values, index=None, sanity=False, column="standard"):
    """ Function to calculate calibration values when standards are written in the excel document"""

    for gas_tank in ref_gas_values:
        ref_gas = df[df[column] == gas_tank]

        if len(ref_gas):
            ref_gas_mean = ref_gas.mean(numeric_only=True)
            ref_gas_stdev = ref_gas.std(numeric_only=True)

            for gas_key in ref_gas_mean.keys():
                if gas_key in ref_gas_values[gas_tank].keys():

                    ref_gas_values[gas_tank][gas_key]["gc_tick_mean"] = ref_gas_mean[gas_key]
                    ref_gas_values[gas_tank][gas_key]["gc_tick_std"] = ref_gas_stdev[gas_key]

                    if ref_gas_values[gas_tank][gas_key]["ref_gas_ppm"] != None:
                        ref_gas_values[gas_tank][gas_key]["gc_ppm_mean"] = ref_gas_values[gas_tank][gas_key]["ref_gas_ppm"] / \
                                                            ref_gas_values[gas_tank][gas_key]["gc_tick_mean"]

    return ref_gas_values


def makeindex(
        num_samples_per_field=3,
        num_flasks=108,
        bracket_size=12,
        min_between_samples=15,
        use_std=["NL"],
        std_gases=["NL", "LA"],
        purge_gas=[-1],
        std_repetitions=[1, 1],
        std_at_end=True,
    ):
    # num_samples_per_field=gasrun["num_samples_per_field"],
    # num_flasks=gasrun["num_flasks"],
    # bracket_size=gasrun["bracket_size"],
    # min_between_samples=gasrun["min_between_samples"],
    # use_std=gasrun["use_std"],
    # std_gases=gasrun["std_gases"],
    # purge_gas=gasrun["purge_gas"],
    # std_repetitions=gasrun["std_repetitions"],
    # std_at_end=gasrun["std_at_end"]

    time_between_samples = min_between_samples * 60
    column_list_ = ["sample_id", "field", "standard", "use_std", "use_sample", "time","calgas"]
    df = pd.DataFrame(columns=column_list_)

    iterations = 0
    standard_its = 1
    sample_its = 1
    field_its = 0
    field = 0
    time = 0

    for run in range(int(num_flasks / bracket_size)):
        for std_run, std_gas in zip(std_repetitions, std_gases):
            for std_repeats in range(std_run):
                df = df.append(pd.DataFrame([[standard_its, None, std_gas, std_gas in use_std, False, None, True]],
                                            columns=column_list_), ignore_index=True)
                iterations += 1
                standard_its += 1

        for i in range(bracket_size):
            if i + 1 in purge_gas:
                use_sample = False
                field_ = None
                time_ = None
                calgas = True
            else:
                use_sample = True
                calgas = False
                time += time_between_samples
                if field_its % num_samples_per_field == 0:
                    time = 0
                    field += 1
                time_ = time
                field_ = field
                field_its += 1

            df = df.append(pd.DataFrame([[sample_its, field_, None, False, use_sample, time_,calgas]], columns=column_list_),
                           ignore_index=True)
            iterations += 1
            sample_its += 1

    if std_at_end:
        for std_run, std_gas in zip(std_repetitions, std_gases):
            for std_repeats in range(std_run):
                df = df.append(pd.DataFrame([[standard_its, None, std_gas, std_gas in use_std, False, None,True]],
                                            columns=column_list_), ignore_index=True)
                iterations += 1
                standard_its += 1

    return df

def infer_values(df, ref_gas_values, gasrun=None,cal_string = "Cal_" ,column= "Unnamed: 10"):

    if gasrun is None:
        gasrun = {"num_samples_per_field": 3,
                  "num_flasks": 108,
                  "bracket_size": 12,
                  "min_between_samples": 15,
                  "use_std": ["NL"],
                  "std_gases": ["NL", "LA"],
                  "purge_gas": [-1],
                  "std_repetitions": [1, 1],
                  "std_at_end": True}

    if df["Sample Id"].dtype != "int64":
        df["Sample Id"]=df["Sample Id"].apply(lambda x: int(x.split("_")[-1]))

    cal_mask = df["File Name"].str.contains(cal_string)
    cals = df[cal_mask]
    calibration_gases = cals[column].unique()
    calibration_gases_verified = []

    for gas in list(calibration_gases):
        if gas in list(ref_gas_values.keys()):
            calibration_gases_verified.append(gas)


    gasrun["std_gases"] = calibration_gases_verified

    gasrun["use_std"] = [cals[column][0]]

    samples = df[cal_mask == False]

    std_repetitions = []

    for v_gas in calibration_gases_verified:
        std_repetitions.append(cals[column][:samples.iloc[0].name].value_counts()[v_gas])

    gasrun["std_repetitions"] = std_repetitions

    co2 = samples["CO2"]

    #gasrun["num_samples_per_field"] = round(1/(1-(co2.iloc[1:].values.astype(int)>co2.iloc[:-1].values).mean()))

    gasrun["num_flasks"] = len(samples)

    gasrun["std_at_end"] = cals.iloc[-1].name > samples.iloc[-1].name

    gasrun["bracket_size"] = samples.loc[cals.iloc[np.sum(std_repetitions)].name-1]["Sample Id"]


    purge_gas = [-1]
    try:
        if len(samples[samples[column].str.contains("LA")]):
            purge_gas = samples[samples[column].str.contains("LA")].loc[:gasrun["bracket_size"]+1]["Sample Id"].values
    except:
        pass

    gasrun["purge_gas"] = purge_gas

    return gasrun




def sanitycheck(df, index,column= "Unnamed: 10"):

    sanity = {"index": False,
              "standard" : False
            }


    standard_locs = index[index["standard"].isnull() == False]
    if (df[column].loc[standard_locs.index] == standard_locs["standard"]).values.all():
        sanity["standard"] = True

    if (df["Sample Id"] == index["sample_id"]).values.all():
        sanity["index"] = True

    return sanity


if __name__ == "__main__":

    pd.set_option('display.width', 220)
    pd.set_option('display.max_columns', 20)

    flux_units = {'N2O': {'name': 'N2O_N_mug_m2h', 'factor': 2 * 14 * 1e6 * 3600},
                  'CO2': {'name': 'CO2_C_mug_m2h', 'factor': 12 * 1e6 * 3600}}

    fixpath = utils.ensure_absolute_path
    options = {'interval': 100,
               'start': 0,
               'stop': 180,
               'crit': 'steepest',
               'co2_guides': True,
               'correct_negatives': False
               }

    save_options = {'show_images': False,
                    'save_images': False,
                    'save_detailed_excel': False,
                    'sort_detailed_by_experiment': False
                    }

    ref_gas_calibration = {'OL': {'CO2': 361., 'CH4': 1.89, 'N2O': 0.585, 'SF6': None, 'H2': None, "luft": 1.},
                           # Old Low
                           'OH': {'CO2': 10000., 'CH4': 10000., 'N2O': 151., 'SF6': None, 'H2': None, "luft": 1.},
                           # Old High
                           'NL': {'CO2': 400., 'CH4': 2.00, 'N2O': 0.500, 'SF6': 0.05, 'H2': None, "luft": 1.},
                           # New Low
                           'NH': {'CO2': 2000., 'CH4': 100., 'N2O': 10., 'SF6': None, 'H2': None, "luft": 1.},
                           # New High
                           'LA': {'CO2': 400., 'CH4': 0., 'N2O': 0., 'SF6': 0., 'H2': 0., "luft": 1.}
                           }


    resdir.raw_data_path = fixpath('raw_data/manual')
    # detailed_output_path = fixpath('output/detailed_regression_output_unsorted')
    # find_regressions.make_detailed_output_folders(detailed_output_path)
    # specific_options_filename = fixpath('specific_options.xls')
    # slopes_filename = fixpath("output/capture_slopes.txt")

    all_filenames = glob.glob(os.path.join(resdir.raw_data_path, '2*'))

    for filename in all_filenames:
        gasrun = {"num_samples_per_field": 3,
                  "num_flasks": 108,
                  "bracket_size": 12,
                  "min_between_samples": 15,
                  "use_std": ["NL"],
                  "std_gases": ["NL", "LA"],
                  "purge_gas": [-1],
                  "std_repetitions": [1, 1],
                  "std_at_end": True}

        df = pd.read_excel(filename, skiprows=2)
        df[["CH4", "CO2", "N2O"]]= df[["CH4", "CO2", "N2O"]].fillna(0).replace("          ",0)
        ref_gas_values = make_calibration_array(ref_gas_calibration)

        gasrun = infer_values(df, ref_gas_values, gasrun)

        index = makeindex(   gasrun["num_samples_per_field"],
                             gasrun["num_flasks"],
                             gasrun["bracket_size"],
                             gasrun["min_between_samples"],
                             gasrun["use_std"],
                             gasrun["std_gases"],
                             gasrun["purge_gas"],
                             gasrun["std_repetitions"],
                             gasrun["std_at_end"])

        sanity = sanitycheck(df,index)
        if all(value == True for value in sanity.values()):
            print(sanity)
            df = df.join(index)
            ref_gas_values = get_ref_gas_Values(df, ref_gas_values)

            for standard in gasrun["use_std"]:
                plotgases = ["luft","CH4","CO2","N2O"]
                fig, axs = plt.subplots(4, sharex=True)
                df_plot = df[(df["calgas"] == True) & (df["standard"] == standard)]
                for i, gas in enumerate(plotgases):
                    axs[i].set_title(standard+" "+gas)
                    axs[i].plot(df_plot[gas])
                plt.show()
                print(ref_gas_values[standard])
                nplots = 18
                # fig, axs = plt.subplots(nplots,4)
                samplegas = df[df["use_sample"]]
                # for k,plot in enumerate(samplegas["field"].unique()[:nplots]):
                #     fieldsample = samplegas[samplegas["field"]==plot]
                #     first = True
                #     for j, gas in enumerate(plotgases):
                #         if first:
                #             axs[0,j].set_title(gas)
                #             first=False
                #         axs[k,j].plot(fieldsample["time"],fieldsample[gas]*ref_gas_values[standard][gas]['gc_ppm_mean'])
                # plt.show()