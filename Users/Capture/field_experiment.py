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

try:
    update_weather_data()
except:
    make_data_file()

fixpath = utils.ensure_absolute_path

start_date = '2021-08-19'
stop_date =  '2099-01-01'  #YYYYMMDD  stop_date has to be one day after the last date you want
redo_regressions = False

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
    logger_path = paths['LOGGER_PATH']
    manual_path = paths['MANUAL']
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

positions = [position(name) for name in all_filenames]
x = np.array([x[0] for x in positions])
y = np.array([x[1] for x in positions])
offset = namedtuple('Point', ('x', 'y'))(x=5.99201e5, y=6.615259e6)
#plt.scatter(x-offset.x, y-offset.y, marker='.')

filenames = [x for x in all_filenames if file_belongs(x)]
print('number of measurement files included in this run:', len(filenames))

filenames.sort() # alphabetically (i.e., by date)

# Make the "regressor object" regr which will be used further below.
# It contains the functions and parameters (options) for doing the regressions.

regr = find_regressions.Regressor(slopes_filename, options, save_options,
                                  specific_options_filename, detailed_output_path)

if not os.path.isfile(slopes_filename):
    open(slopes_filename, 'a').close() #creates the file

if redo_regressions:
    regr.find_regressions(filenames)
else:
    regr.update_regressions_file(filenames) #updates resfile


pd.set_option('display.width', 220)
pd.set_option('display.max_columns', 20)

df = sr.make_simple_df_from_slope_file(slopes_filename)

df = df.sort_values('date').reset_index(drop=True)


rect1 = polygon_utils.Polygon(0, 0, W=37.5, L=48)
rect1.rotate(.4152).move(15.2,-2.55)

rectangles = rect1.grid(6,6)

polygon_utils.plot_rectangles(rectangles, textkwargs={'fontsize': 5}, linewidth=.1)

df['nr'] = [polygon_utils.find_polygon(p[0]-offset.x, p[1]-offset.y, rectangles) + 1
            for p in  zip(df.x, df.y)]


treatmentlist = [( 1,  6), ( 2,  2), ( 3, 12), ( 4,  7), ( 5,  4), ( 6,  9),
                 ( 7, 11), ( 8, 10), ( 9,  1), (10,  5), (11,  8), (12,  3),
                 (13, 12), (14, 11), (15,  4), (16, 10), (17,  5), (18,  2),
                 (19,  1), (20,  7), (21,  8), (22,  6), (23,  3), (24,  9),
                 (25,  3), (26, 10), (27,  2), (28,  4), (29,  5), (30,  1),
                 (31, 11), (32,  6), (33, 12), (34,  9), (35,  8), (36,  7)]

treatments = {x[0]:x[1] for x in treatmentlist}

df['treatment'] = [treatments[i] for i in df.nr]

polygon_utils.plot_rectangles(rectangles, textkwargs={'fontsize': 5}, linewidth=.1)

colors = 'bgrcmyk'*10
markers = '.......xxxxxxx'*5

for t in sorted(set(df.treatment)):
    d = df[df.treatment==t]
    plt.scatter(d.x-offset.x, d.y-offset.y, s=10, color=colors[t-1], marker=markers[t-1])

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

