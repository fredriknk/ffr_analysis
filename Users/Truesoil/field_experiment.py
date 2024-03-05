"""
 Fredriks capture experiments
"""
 
# First, select this file's directory in the white bar up to the
# right. You can do this by right-clicking on ".py" above and choosing
# "Set console working directory"
 
# The button that runs current "cell" executes the code highlighted
# (Cells are code between lines starting with # %%)
  
# %% Imports:
import sys
import os
import glob
from collections import namedtuple
import numpy as np
import pylab as plt
import pandas as pd
import logging
pd.options.mode.chained_assignment = None
pth = os.path.realpath(os.path.join(os.getcwd(), '../../prog'))
if not pth in sys.path:
    sys.path.append(pth)
import resdir
import get_data
import utils
import find_regressions
import sort_results as sr
import weather_data
import flux_calculations
import polygon_utils
from weather_data_from_metno import update_weather_data, make_data_file
from yaml import safe_load
from ffr_gui import make_dataset, check_exclude

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logging.getLogger('matplotlib.font_manager').disabled = True

def read_yaml(file_path = "config.yml"):
    with open(file_path, "r") as f:
        return safe_load(f)


def plot_something(df, key, value, what="N2O", **kwargs):
    d = df[df[key]==value]
    kwargs = {**{'linewidth': .5, 'marker':'.', 'markersize':2}, **kwargs}
    plt.plot(d.days, d.N2O_N_mug_m2h if what=="N2O" else d.CO2_C_mug_m2h,
             label=value, **kwargs)

def plot_treatment(df, treatment, what="N2O", **kwargs):
    plot_something(df, 'treatment', treatment, what, **kwargs)

def plot_nr(df, nr, what="N2O", **kwargs):
    plot_something(df, 'nr', nr, what, **kwargs)

def position(filename):
    a = get_data.parse_filename(filename)['vehicle_pos']
    return np.array([a['x'], a['y']])

def file_belongs(filename):
    name = os.path.split(filename)[1]
    date_ok = start_date <= name.replace('-','') <= stop_date
    x, y = position(filename)
    pos_ok = 0 < x - offset.x < 45 and 0 < y - offset.y < 55
    #text_ok = name.find('Measure') > -1
    return date_ok and pos_ok
def finalize_df(df, precip_dt=2):
    df['Tc'] = weather_data.data.get_temp(df.t)
    df['precip'] = weather_data.data.get_precip(df.t)
    df['N2O_mol_m2s'] = flux_calculations.calc_flux(df.N2O_slope, df.Tc)
    df['CO2_mol_m2s'] = flux_calculations.calc_flux(df.CO2_slope, df.Tc)
    Nunits = flux_units['N2O']
    Cunits = flux_units['CO2']
    df[Nunits['name']] = Nunits['factor'] *  df.N2O_mol_m2s
    df[Cunits['name']] = Cunits['factor'] *  df.CO2_mol_m2s
    df = sr.rearrange_df(df)
    return df

def find_treatment_number(plot_number,treatment_legends):
    """
    This function takes a plot number and returns the treatment number
    based on the treatment_legend provided.
    """
    for treatment_number, details in treatment_legends.items():
        if plot_number in details['plots']:
            return treatment_number
    return None

try:
    update_weather_data()
except:
    make_data_file()

fixpath = utils.ensure_absolute_path

start_date = '2021-08-19'
stop_date =  '2099-01-01'  #YYYYMMDD  stop_date has to be one day after the last date you want
redo_regressions = True

options = {'interval': 100,
           'start':0,
           'stop':180,
           'crit': 'steepest',
           'co2_guides': True,
           'correct_negatives':False,
           'cut_beginnings':7,
           'cut_ends':7
           }

save_options= {'show_images':False,
               'save_images':False,
               'save_detailed_excel':False,
               'sort_detailed_by_experiment':False,
               'show_last_runs':False
               }

remove_redoings_time = 10 #seconds

flux_units = {'N2O': {'name': 'N2O_N_mug_m2h', 'factor': 2 * 14 * 1e6 * 3600},
              'CO2': {'name': 'CO2_C_mug_m2h', 'factor': 12 * 1e6 * 3600}}

specific_options_filename = fixpath('specific_options.pickle')

try:
    DATA_FILE_NAME = "config.yml"
    paths = read_yaml(DATA_FILE_NAME)["PATHS"]
    resdir.raw_data_path = paths["RAWDATA"]
    if "MANUAL" in paths:
        manual_path = paths['MANUAL']
    if "LOGGER_PATH" in paths:
        logger_path = paths['LOGGER_PATH']
except FileNotFoundError:
    print(DATA_FILE_NAME + ' not found')
    resdir.raw_data_path = fixpath('raw_data')

detailed_output_path = fixpath('output/detailed_regression_output_unsorted')
find_regressions.make_detailed_output_folders(detailed_output_path)

excel_filename_start = "output/capture"
slopes_filename = fixpath("output/capture_slopes.txt")

# Finding the raw data files
all_filenames = glob.glob(os.path.join(resdir.raw_data_path, '2*'))
print("number of measurement files from robot: %d" % len(all_filenames))
filename_substring = "_Plot_" # all result file names should contains this

slopes_filename = fixpath("output/slopes_"+ filename_substring + ".txt")

if not os.path.isfile(slopes_filename):
    open(slopes_filename, 'a').close() #creates the file
# Finding the raw data files
all_filenames = glob.glob(os.path.join(resdir.raw_data_path, '2*'))
print("number of measurement files from robot: %d" % len(all_filenames))

# hvis noen filer er helt ødelagt:
broken = []

def file_belongs(filename):
    name = os.path.split(filename)[1]
    date_ok = start_date <= name.replace('-','') <= stop_date
    text_ok = name.find(filename_substring) > -1
    return date_ok and text_ok and (name not in broken)

filenames = [x for x in all_filenames if file_belongs(x)]

if len(filenames) == 0:
    raise Exception("No files found. Check filename_substring etc")
print('number of measurement files included in this run:', len(filenames))

filenames.sort() # alphabetically (i.e., by date)

# Make the "regressor object" regr which will be used further below.
# It contains the functions and parameters (options) for doing the regressions.

regr = find_regressions.Regressor(slopes_filename, options, save_options,
                                  specific_options_filename, detailed_output_path)

if not os.path.isfile(slopes_filename):
    open(slopes_filename, 'a').close() #creates the file

logging.debug(f"filnames fe: {filenames}")
if redo_regressions:
    regr.find_regressions(filenames)
else:
    regr.update_regressions_file(filenames) #updates resfile


pd.set_option('display.width', 220)
pd.set_option('display.max_columns', 20)

df = sr.make_simple_df_from_slope_file(slopes_filename)

df = df.sort_values('date').reset_index(drop=True)

import re
def station_nr(filename):
    """return the number at the end of the raw data filename"""
    return int(re.findall(r'\d+', filename)[-1])


df['meas_nr'] = [station_nr(x) for x in df.filename]

Field_numbers = {
    (1, 'left'):  17,
    (1, 'right'): 1,
    (2, 'left'):  18,
    (2, 'right'): 2,
    (3, 'left'):  19,
    (3, 'right'): 3,
    (4, 'left'):  20,
    (4, 'right'): 4,
    (5, 'left'):  21,
    (5, 'right'): 5,
    (6, 'left'):  22,
    (6, 'right'): 6,
    (7, 'left'):  23,
    (7, 'right'): 7,
    (8, 'left'): 24,
    (8, 'right'): 8,
    (9, 'left'): 25,
    (9, 'right'): 9,
    (10, 'left'): 26,
    (10, 'right'):10,
    (11, 'left'): 27,
    (11, 'right'):11,
    (12, 'left'): 28,
    (12, 'right'):12,
    (13, 'left'): 29,
    (13, 'right'):13,
    (14, 'left'): 30,
    (14, 'right'):14,
    (15, 'left'): 31,
    (15, 'right'):15,
    (16, 'left'): 32,
    (16, 'right'):16,
    (17, 'left'): 16,
    (17, 'right'):32,
    (18, 'left'): 15,
    (18, 'right'):31,
    (19, 'left'): 14,
    (19, 'right'):30,
    (20, 'left'): 13,
    (20, 'right'):29,
    (21, 'left'): 12,
    (21, 'right'):28,
    (22, 'left'): 11,
    (22, 'right'):27,
    (23, 'left'): 10,
    (23, 'right'):26,
    (24, 'left'): 9,
    (24, 'right'):25,
    (25, 'left'): 8,
    (25, 'right'):24,
    (26, 'left'): 7,
    (26, 'right'):23,
    (27, 'left'): 6,
    (27, 'right'):22,
    (28, 'left'): 5,
    (28, 'right'):21,
    (29, 'left'): 4,
    (29, 'right'):20,
    (30, 'left'): 3,
    (30, 'right'):19,
    (31, 'left'): 2,
    (31, 'right'):18,
    (32, 'left'): 1,
    (32, 'right'):17
}

# 1:{"name": "verbalt navn", "treatment": "kortavn", "plots":(1,6,7)},
treatment_legend = {
    1: {"name": "Regntak", "treatment": "R", "plots": (1, 3, 5, 7, 9, 11, 13, 15)},
    2: {"name": "Kontroll (regntak)", "treatment": "K", "plots": (2, 4, 6, 8, 10, 12, 14, 16)},
    3: {"name": "Kontroll (overfor)", "treatment": "O", "plots": (17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32)}
}


df["nr"] = [Field_numbers[(i, s)] for i, s in zip(df.meas_nr, df.side)]
df['treatment'] = [find_treatment_number(i,treatment_legend) for i in df.nr]

colors = 'bgrcmyk'*10
markers = '.......xxxxxxx'*5

for t in sorted(set(df.treatment)):
    d = df[df.treatment==t]
    plt.scatter(d.x, d.y, s=10, color=colors[t-1], marker=markers[t-1])

plt.axis('square')
plt.show()

df = finalize_df(df)
df['days'] = (df.t - min(df.t))/86400

print('from ', df.date.min())
print('to   ', df.date.max())

openthefineapp = False
excel_filenames = [fixpath(excel_filename_start + '_' + s + '.xlsx')
                   for s in 'RegressionOutput slopes all_columns'.split()]

# First, the main RegressionOutput file
try:
    df.to_excel(excel_filenames[0])
    print('Regression Output file(s) written to parent directory')
    if openthefineapp:
        os.system(excel_filenames[0])
except:
    print('Regression Output file(s) NOT written -- was it open?')
    pass

# _slopes and _all_columns are additional output files with regression results sorted by date
print(flux_units['N2O']['name'])
tokeep = ['t', 'date', 'days', 'nr', 'side', 'treatment',
          flux_units['N2O']['name'], flux_units['CO2']['name'],
          'N2O_slope', 'CO2_slope', 'filename']

df2 = df[df['options'].apply(check_exclude)][tokeep]

print("Making complete dataset")
df['index1'] = df.index
df_all,df_weather = make_dataset(df)
df_all.index=df_all.index1
df_all["excluded"] = df_all['options'].apply(check_exclude)
#write dataframe to pickle file
df_all.to_pickle('./output/df_all.pkl')
df_weather.to_pickle('./output/df_weather.pkl')


df2.to_excel(excel_filenames[1])

